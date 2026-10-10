import React from 'react';

import type { GlobalPrefs } from '@actual-app/core/types/prefs';
import type { McpServerStatus } from '@actual-app/core/typings/window';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock(
  '@actual-app/core/platform/client/connection',
  () => import('#mocks/connection'),
);

const TOKEN = 'abcd1234567890wxyz';

function statusFor(
  config: GlobalPrefs['mcpServerConfig'],
  error: string | null = null,
): McpServerStatus {
  const port = config?.port ?? 5008;
  const isRunning = !!config?.enabled && !error;
  return {
    isRunning,
    port: isRunning ? port : null,
    url: isRunning ? `http://127.0.0.1:${port}/mcp` : null,
    error,
  };
}

describe('McpServerSettings', () => {
  let savedPrefs: GlobalPrefs[];
  let startError: string | null;
  let clipboardText: string | null;
  let cleanupRender: (() => void) | undefined;

  async function renderSettings(config?: GlobalPrefs['mcpServerConfig']) {
    // The setup file already loaded the store with the real connection, so
    // reload the modules to pick up the mocked one (as prefsSlice.test does).
    // Testing Library's render is reloaded too so it shares the component's
    // React; queries and events only need the DOM.
    vi.resetModules();
    const { initServer } =
      await import('@actual-app/core/platform/client/connection');
    const { cleanup, render } = await import('@testing-library/react');
    cleanupRender = cleanup;
    const { configureTestAppStore, createTestQueryClient, TestProviders } =
      await import('#mocks');
    const { mergeGlobalPrefs } = await import('#prefs/prefsSlice');
    const { McpServerSettings } = await import('./McpServer');

    const store = configureTestAppStore({
      queryClient: createTestQueryClient(),
    });
    if (config) {
      store.dispatch(mergeGlobalPrefs({ mcpServerConfig: config }));
    }

    // The desktop app's main process reads the saved preferences on start
    let currentConfig = config;
    initServer({
      'save-global-prefs': async (prefs: GlobalPrefs) => {
        savedPrefs.push(prefs);
        currentConfig = prefs.mcpServerConfig;
        return 'ok';
      },
    });
    window.Actual = {
      ...window.Actual,
      getMcpServerStatus: vi.fn(async () => statusFor(currentConfig)),
      startMcpServer: vi.fn(async () => statusFor(currentConfig, startError)),
    };

    render(
      <TestProviders store={store}>
        <McpServerSettings />
      </TestProviders>,
    );
    // The reloaded React renders asynchronously, outside Testing Library's act
    await screen.findByText('AI assistant access (MCP server)');

    return {
      user: userEvent,
      // Saving and restarting happen asynchronously after the click
      waitForRestart: () =>
        waitFor(() =>
          expect(window.Actual.startMcpServer).toHaveBeenCalledTimes(1),
        ),
    };
  }

  afterEach(() => {
    cleanupRender?.();
  });

  beforeEach(() => {
    savedPrefs = [];
    startError = null;
    clipboardText = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async (text: string) => {
          clipboardText = text;
        }),
      },
    });
  });

  it('hides the server settings while the server is disabled', async () => {
    await renderSettings();

    expect(
      screen.getByRole('checkbox', { name: 'Enable the MCP server' }),
    ).not.toBeChecked();
    expect(screen.queryByLabelText('Port')).not.toBeInTheDocument();
  });

  it('creates an access token and starts the server when enabled', async () => {
    const { user, waitForRestart } = await renderSettings();

    await user.click(
      screen.getByRole('checkbox', { name: 'Enable the MCP server' }),
    );
    await waitForRestart();

    expect(savedPrefs).toHaveLength(1);
    const config = savedPrefs[0].mcpServerConfig;
    expect(config).toMatchObject({ enabled: true, port: 5008 });
    expect(config?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await screen.findByText(
        'Running and listening on http://127.0.0.1:5008/mcp',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the existing token when the server is enabled again', async () => {
    const { user, waitForRestart } = await renderSettings({
      enabled: false,
      port: 5008,
      token: TOKEN,
    });

    await user.click(
      screen.getByRole('checkbox', { name: 'Enable the MCP server' }),
    );
    await waitForRestart();

    expect(savedPrefs[0].mcpServerConfig?.token).toBe(TOKEN);
  });

  it('rejects ports outside the valid range without saving', async () => {
    const { user } = await renderSettings({
      enabled: true,
      port: 5008,
      token: TOKEN,
    });

    const portInput = screen.getByLabelText('Port');
    await user.clear(portInput);
    await user.type(portInput, '70000');
    await user.click(screen.getByRole('button', { name: 'Save and restart' }));

    expect(
      screen.getByText('Ports must be within range 1 - 65535'),
    ).toBeInTheDocument();
    expect(savedPrefs).toHaveLength(0);
    expect(window.Actual.startMcpServer).not.toHaveBeenCalled();
  });

  it('saves a new port and restarts the server', async () => {
    const { user, waitForRestart } = await renderSettings({
      enabled: true,
      port: 5008,
      token: TOKEN,
    });

    const portInput = screen.getByLabelText('Port');
    await user.clear(portInput);
    await user.type(portInput, '5010');
    await user.click(screen.getByRole('button', { name: 'Save and restart' }));
    await waitForRestart();

    expect(savedPrefs[0].mcpServerConfig).toEqual({
      enabled: true,
      port: 5010,
      token: TOKEN,
    });
    expect(
      await screen.findByText(
        'Running and listening on http://127.0.0.1:5010/mcp',
      ),
    ).toBeInTheDocument();
  });

  it('explains when the port is already in use', async () => {
    startError = 'port-in-use';
    const { user, waitForRestart } = await renderSettings({
      enabled: true,
      port: 5008,
      token: TOKEN,
    });

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitForRestart();

    expect(
      await screen.findByText(
        'The port is already used by another program. Choose another port.',
      ),
    ).toBeInTheDocument();
  });

  it('masks the token in the setup command but copies it in full', async () => {
    const { user } = await renderSettings({
      enabled: true,
      port: 5008,
      token: TOKEN,
    });

    const command =
      'claude mcp add --transport http actual-budget http://127.0.0.1:5008/mcp --header "Authorization: Bearer ';
    expect(screen.getByText(`${command}abcd…wxyz"`)).toBeInTheDocument();

    const copyButtons = screen.getAllByRole('button', { name: 'Copy' });
    await user.click(copyButtons[copyButtons.length - 1]);

    expect(clipboardText).toBe(`${command}${TOKEN}"`);
    expect(
      await screen.findAllByRole('button', { name: 'Copied' }),
    ).toHaveLength(1);
  });
});
