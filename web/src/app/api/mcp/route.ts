import { NextResponse } from "next/server";
import { CORS, handle, TOOLS, type RpcRequest } from "@/lib/mcp";

// Lien as tools for AI agents over the Model Context Protocol (streamable HTTP).
// The protocol and the tools live in lib/mcp.ts; this file is only the HTTP edge.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS }); }
  const batch = Array.isArray(body) ? body : [body];
  const answers = (await Promise.all(batch.map((m) => handle(m as RpcRequest)))).filter(Boolean);
  if (!answers.length) return new NextResponse(null, { status: 202, headers: CORS });
  return NextResponse.json(Array.isArray(body) ? answers : answers[0], { headers: CORS });
}

export async function GET() {
  return NextResponse.json({ name: "Lien MCP server", transport: "streamable-http (POST JSON-RPC)", tools: TOOLS.map((t) => t.name), docs: "https://lien-five.vercel.app/guide" }, { headers: CORS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
