import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { plainError, ToolError } from "./errors";
import { outputJson } from "./output";

export type ToolHandler = (args: unknown) => Promise<unknown>;
export class ToolRegistry {
  private tools = new Map<string, { definition: Tool; handler: ToolHandler }>();
  add(definition: Tool, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) throw new Error("Duplicate MCP tool registration.");
    this.tools.set(definition.name, { definition, handler });
  }
  list(): Tool[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }
  async call(name: string, args: unknown) {
    try {
      const tool = this.tools.get(name);
      if (!tool)
        throw new ToolError("unknown_tool", "This tool is not installed in this Tally checkout.");
      const result = await tool.handler(args);
      return {
        content: [
          {
            type: "text" as const,
            text: outputJson(result),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: outputJson(plainError(error)) }],
      };
    }
  }
}
