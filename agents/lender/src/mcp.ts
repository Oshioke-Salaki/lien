// The agent's only window on Lien: the public MCP server, over plain HTTP JSON-RPC.
// It never reads the chain for decisions; it signs and sends what the server
// prepares, after checking it (see guard.ts).

export type ToolResult<T = any> = { ok: true; data: T; text: string } | { ok: false; data: any; text: string };

export class Mcp {
  private id = 0;
  constructor(readonly url: string) {}

  private async rpc(method: string, params: object = {}): Promise<any> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
          signal: AbortSignal.timeout(60_000),
        });
        const body = (await response.json()) as { result?: any; error?: { message: string } };
        if (body.error) throw new Error(`MCP ${method}: ${body.error.message}`);
        return body.result;
      } catch (error) {
        last = error;
        await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
      }
    }
    throw last;
  }

  async initialize() {
    return this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lien-lender", version: "1.0.0" } });
  }

  async tools(): Promise<string[]> {
    return ((await this.rpc("tools/list")).tools as { name: string }[]).map((t) => t.name);
  }

  /** A tool call. A tool error (a refusal, bad input) is a result, not an exception. */
  async call<T = any>(name: string, args: object = {}): Promise<ToolResult<T>> {
    const result = await this.rpc("tools/call", { name, arguments: args });
    const text = String(result?.content?.[0]?.text ?? "");
    if (result?.isError) return { ok: false, data: result.structuredContent ?? null, text };
    return { ok: true, data: (result.structuredContent ?? JSON.parse(text)) as T, text };
  }

  /** Like call, for tools whose failure should stop the run. */
  async must<T = any>(name: string, args: object = {}): Promise<T> {
    const out = await this.call<T>(name, args);
    if (!out.ok) throw new Error(`${name}: ${out.text}`);
    return out.data;
  }
}
