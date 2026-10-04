import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRuntime, unsignedEnv } from "./runtime";
import { createServer } from "./server";
import { execFileSync } from "node:child_process";
import { FIXTURE_SWAP_HASH } from "@tally/engine";

describe("MCP client interoperability", () => {
  it("stdio initialization, discovery and real fixture calls work with no stdout noise", async () => {
    const safe = unsignedEnv(process.env);
    const env = Object.fromEntries(
      Object.entries(safe).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts"],
      cwd: process.cwd(),
      env: { ...env, TALLY_FIXTURES: "1" },
      stderr: "pipe",
    });
    const client = new Client({ name: "wo05-test", version: "1" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual([
        "get_consolidated_quote",
        "get_shares_of",
        "get_integrity",
        "build_guarded_swap",
      ]);
      const quote = await client.callTool({
        name: "get_consolidated_quote",
        arguments: { ticker: "NVDA", usd: 6 },
      });
      const text = quote.content as { type: string; text: string }[];
      expect(JSON.parse(text[0]!.text).rows).toHaveLength(3);
      expect(quote.isError).not.toBe(true);
    } finally {
      await client.close();
    }
  }, 15_000);
  it("returns MCP isError for invalid arguments", async () => {
    const server = await createServer(createRuntime({ TALLY_FIXTURES: "1" }, () => undefined));
    const client = new Client({ name: "validation-test", version: "1" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: "build_guarded_swap",
        arguments: { ticker: "NVDA" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("unsigned CLI receipt fallback parses the existing engine receipt in shares", () => {
    const env = { ...unsignedEnv(process.env), TALLY_FIXTURES: "1" };
    const output = execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", "receipt"], {
      cwd: process.cwd(),
      env,
      input: JSON.stringify({ txHash: FIXTURE_SWAP_HASH, ticker: "NVDA" }),
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toMatchObject({
      fixtures: true,
      status: "success",
      fill: {
        shares: "25704894000000000",
        premium: expect.any(Number),
        usdPerShare: expect.any(Number),
      },
    });
  });
});
