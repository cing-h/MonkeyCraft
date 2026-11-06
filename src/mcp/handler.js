// A minimal MCP server (JSON-RPC 2.0) served over Streamable HTTP by the sidecar.
// Claude Code connects to /mcp/<runId> with that run's secret token, so each
// run sees only its creature's tools, and every call enters registry.dispatch().
//
// handleMcp(message, deps) returns a JSON-RPC response object, or null for a
// notification. It never throws.

export const SERVER_INFO = { name: 'monkeycraft', version: '0.1.0' };
const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const err = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });

/** deps: { listTools() -> [{name, description, inputSchema}], callTool(name, args) -> Promise<{content, isError}> } */
export async function handleMcp(msg, deps) {
  if (msg && msg.jsonrpc === '2.0' && msg.method === undefined && ('result' in msg || 'error' in msg)) return null; // a response to us: ignore
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(msg?.id, -32600, 'Invalid request');
  const isNote = !('id' in msg);
  try {
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        return ok(msg.id, {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: 'MonkeyCraft tools. Every action that changes something asks the user first.'
        });
      }
      case 'ping': return ok(msg.id, {});
      case 'tools/list': return ok(msg.id, { tools: deps.listTools() });
      case 'tools/call': {
        const name = msg.params?.name, args = msg.params?.arguments ?? {};
        if (typeof name !== 'string') return err(msg.id, -32602, 'tools/call needs a tool name');
        const r = await deps.callTool(name, args);
        return ok(msg.id, { content: [{ type: 'text', text: r.content || '(no output)' }], isError: !!r.isError });
      }
      default:
        if (isNote) return null; // notifications/initialized, notifications/cancelled, …
        return err(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    return isNote ? null : err(msg.id, -32603, `Internal error: ${e.message}`);
  }
}
