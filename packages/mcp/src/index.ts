import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntime } from "./runtime";
import { createServer } from "./server";

try {
  const server = await createServer(createRuntime());
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write(
    "Tally MCP could not start. Check server configuration or use TALLY_FIXTURES=1.\n",
  );
  process.exitCode = 1;
}
