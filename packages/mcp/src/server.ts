import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerOptionalTools } from "./optional";
import type { Runtime } from "./runtime";
import { registerTools } from "./tools";

export async function createServer(runtime: Runtime) {
  const registry = registerTools(runtime);
  await registerOptionalTools(registry, runtime);
  const server = new Server({ name: "tally", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.list() }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    registry.call(request.params.name, request.params.arguments ?? {}),
  );
  return server;
}
