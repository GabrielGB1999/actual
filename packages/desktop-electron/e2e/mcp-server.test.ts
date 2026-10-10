// oxlint-disable no-restricted-imports --fix me
import { ConfigurationPage } from '@actual-app/web/e2e/page-models/configuration-page';
import { Navigation } from '@actual-app/web/e2e/page-models/navigation';
import { expect } from '@playwright/test';

import { test } from './fixtures';

const MCP_URL = 'http://127.0.0.1:5008/mcp';

async function callMcp(token: string, body: unknown) {
  return fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  });
}

async function callTool(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  const response = await callMcp(token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  expect(response.status).toBe(200);
  const { result } = await response.json();
  expect(result.isError).toBe(false);
  return JSON.parse(result.content[0].text);
}

test.describe('MCP server', () => {
  test('lets an AI client read the open budget', async ({ electronPage }) => {
    const configurationPage = new ConfigurationPage(electronPage);
    await configurationPage.clickOnNoServer();
    await configurationPage.createDemoFile();

    const navigation = new Navigation(electronPage);
    await navigation.goToSettingsPage();
    await electronPage.getByLabel('Enable the MCP server').check();
    await expect(
      electronPage.getByText(`Running and listening on ${MCP_URL}`),
    ).toBeVisible();

    const token = await electronPage
      .locator('#settings-mcpServerToken')
      .inputValue();
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // Requests without the token are refused
    const unauthorized = await callMcp('wrong-token', {
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
    });
    expect(unauthorized.status).toBe(401);

    const accounts = await callTool(token, 'list_accounts');
    expect(accounts.map((account: { name: string }) => account.name)).toEqual(
      expect.arrayContaining(['Bank of America', 'Ally Savings']),
    );

    // Reading the budget doesn't change it
    const transactionCount = async () =>
      (
        await callTool(token, 'query', {
          table: 'transactions',
          calculate: { $count: '$id' },
        })
      ).result;
    const countBefore = await transactionCount();
    await callTool(token, 'summarize_transactions', { groupBy: 'category' });
    await callTool(token, 'get_transactions', { limit: 10 });
    expect(await transactionCount()).toBe(countBefore);

    // Disabling the server closes the port
    await electronPage.getByLabel('Enable the MCP server').uncheck();
    await expect(electronPage.getByLabel('Port', { exact: true })).toBeHidden();
    await expect(
      callMcp(token, { jsonrpc: '2.0', id: 1, method: 'ping' }),
    ).rejects.toThrow();
  });
});
