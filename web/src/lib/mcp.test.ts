import { describe, expect, it } from "vitest";
import { account, amount, business, handle, InputError, TOOLS } from "./mcp";

describe("MCP input checks", () => {
  it("reads decimal token amounts exactly, with at most six decimals", () => {
    expect(amount("12.5", "amount")).toBe(12_500_000n);
    expect(amount("0.000001", "amount")).toBe(1n);
    expect(amount(" 3 ", "amount")).toBe(3_000_000n);
    for (const bad of ["", "0", "-1", "1e3", "1.0000001", "abc", "1,5"]) expect(() => amount(bad, "amount")).toThrow(InputError);
  });

  it("accepts NEAR account ids and refuses anything else", () => {
    expect(account("Buyer.Testnet", "x")).toBe("buyer.testnet");
    for (const bad of ["a", "bad..id", "-x.testnet", "x".repeat(65), "has space.testnet"]) expect(() => account(bad, "x")).toThrow(InputError);
  });

  it("lets an agent name a business by its short name", () => {
    expect(business("sentinel")).toBe("sentinel.v1.lien-13569.testnet");
    expect(business("sentinel.v1.lien-13569.testnet")).toBe("sentinel.v1.lien-13569.testnet");
  });
});

describe("MCP protocol", () => {
  it("introduces itself and lists its tools, each with a schema", async () => {
    const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(init).toMatchObject({ id: 1, result: { serverInfo: { name: "lien" }, capabilities: { tools: {} } } });
    const list = (await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as { result: { tools: typeof TOOLS } };
    expect(list.result.tools.map((t) => t.name)).toContain("prepare_lend");
    for (const tool of list.result.tools) expect(tool.inputSchema.type).toBe("object");
  });

  it("answers notifications with nothing and unknown methods with an error", async () => {
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await handle({ jsonrpc: "2.0", id: 3, method: "nope" })).toMatchObject({ error: { code: -32601 } });
  });

  it("turns bad tool input into a readable tool error, before touching the network", async () => {
    const out = (await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "prepare_repay", arguments: { business: "sentinel", payer: "a.testnet", amount: "-5" } } })) as { result: { isError: boolean; content: { text: string }[] } };
    expect(out.result.isError).toBe(true);
    expect(out.result.content[0].text).toMatch(/decimal amount/);
  });
});
