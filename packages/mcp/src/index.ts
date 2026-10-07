import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

try {
  if (process.argv.includes("--http")) {
    const { startHttpServer } = await import("./http");
    const server = await startHttpServer();
    process.once("SIGINT", () => server.close());
    process.once("SIGTERM", () => server.close());
  } else {
    const server = await createServer();
    await server.connect(new StdioServerTransport());
  }
} catch {
  process.stderr.write(
    "Tally MCP could not start. Check server configuration or use TALLY_FIXTURES=1.\n",
  );
  process.exitCode = 1;
}
