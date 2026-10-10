import { createApp } from '#server/app';
import { app as mainApp } from '#server/main-app';

import { handleMcpMessage } from './protocol';
import { createMcpTools, MCP_SERVER_INSTRUCTIONS } from './tools';
import type { McpReadOnlyHandlers } from './tools';

export type McpHandlers = {
  'mcp-handle-message': typeof handleMessage;
};

export const app = createApp<McpHandlers>();

// Not wrapped in `mutator`: answering MCP messages only ever reads data.
app.method('mcp-handle-message', handleMessage);

function getReadOnlyHandlers(): McpReadOnlyHandlers {
  // The type only exposes the allow-listed read-only handlers to the tools
  const handlers: McpReadOnlyHandlers = mainApp.handlers;
  return handlers;
}

/**
 * Answers a single MCP (JSON-RPC) message received by the desktop app's local
 * MCP endpoint. Returns `null` when the message needs no response.
 */
async function handleMessage({
  message,
  version,
}: {
  message: unknown;
  version?: string;
}) {
  return handleMcpMessage(
    {
      tools: createMcpTools(getReadOnlyHandlers()),
      version: version || 'unknown',
      instructions: MCP_SERVER_INSTRUCTIONS,
    },
    message,
  );
}
