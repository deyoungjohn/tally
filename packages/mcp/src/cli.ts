import { createRuntime } from "./runtime";
import { registerTools } from "./tools";
import { plainError } from "./errors";
import { object, only, ticker } from "./input";
import { ToolError } from "./errors";
import { outputJson } from "./output";

// An unsigned, one-shot tool runner. Accepts JSON on stdin to avoid shell interpolation of calldata.
try {
  const name = process.argv[2];
  if (!name) throw new Error("Missing tool name.");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const runtime = createRuntime();
  const args: unknown = JSON.parse(input || "{}");
  if (name === "receipt") {
    const data = object(args);
    only(data, ["txHash", "ticker"]);
    if (typeof data.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data.txHash))
      throw new ToolError("invalid_request", "Provide the transaction hash.");
    const result = await runtime.engine.trade.receipt(
      data.txHash as `0x${string}`,
      ticker(data.ticker),
    );
    process.stdout.write(outputJson({ ...result, fixtures: runtime.fixtures }) + "\n");
  } else {
    const result = await registerTools(runtime).call(name, args);
    process.stdout.write(result.content[0]!.text + "\n");
    if (result.isError) process.exitCode = 1;
  }
} catch (error) {
  process.stdout.write(outputJson(plainError(error)) + "\n");
  process.exitCode = 1;
}
