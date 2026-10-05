import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerOptionalTools } from "./optional";
import { createRuntime, type Runtime } from "./runtime";
import { registerTools, toolDefinitions } from "./tools";
import { isMissingCredentialsError, plainError, ToolError } from "./errors";
import { ToolRegistry } from "./registry";

export async function createServer(runtime?: Runtime) {
  const registry = new ToolRegistry();
  try {
    runtime ??= createRuntime();
  } catch (error) {
    if (!isMissingCredentialsError(error)) throw error;
    const mapped = plainError(error);
    for (const definition of toolDefinitions(false))
      registry.add(definition, async () => {
        throw new ToolError(mapped.kind, mapped.message);
      });
  }
  if (runtime) {
    registerTools(runtime, registry);
    await registerOptionalTools(registry, runtime);
  }
  const server = new Server({ name: "tally", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: registry.list() }));
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    registry.call(request.params.name, request.params.arguments ?? {}),
  );
  return server;
}
