import type { Engine } from "@tally/engine";
import { openStore, type SnapshotStore } from "@tally/modkit";
import {
  HINT_KIND,
  RECEIPTS_KIND,
  RECEIPT_MAX_AGE_MS,
  type StoredHint,
  type StoredReceipt,
} from "@tally/mod-receipts";
import type { ToolRegistry } from "../registry";
import { ToolError } from "../errors";
import { object, only } from "../input";

/** Read-only snapshot lookup: no signing, broadcasting, hot RPC or promotion of browser claims. */
export async function register(
  registry: ToolRegistry,
  _engine: Engine,
  options: { store?: SnapshotStore; now?: () => number; enabled?: boolean } = {},
): Promise<void> {
  if (!(options.enabled ?? process.env.FEATURE_RECEIPTS === "1")) return;
  registry.add(
    {
      name: "get_receipt",
      description:
        "Read verified BNB Chain receipt evidence and explicitly labelled pending hints. Quotes may be unverified client claims.",
      inputSchema: {
        type: "object",
        properties: { txHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } },
        required: ["txHash"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const args = object(input);
      only(args, ["txHash"]);
      if (typeof args.txHash !== "string" || !/^0x[\da-f]{64}$/i.test(args.txHash))
        throw new ToolError("invalid_request", "Provide a BNB Chain transaction hash.");
      let owned: ReturnType<typeof openStore> | undefined;
      try {
        const store = options.store ?? (owned = openStore());
        const now = (options.now ?? Date.now)();
        const hash = args.txHash.toLowerCase(),
          opts = { maxAgeMs: RECEIPT_MAX_AGE_MS, now };
        const receipt = store.latest<StoredReceipt>(RECEIPTS_KIND, hash, opts);
        if (receipt)
          return {
            state: "verified",
            txHash: hash,
            source: receipt.source,
            observedAt: receipt.observedAt,
            ageMs: receipt.ageMs,
            stale: receipt.stale,
            evidence: receipt.data,
          };
        const hint = store.latest<StoredHint>(HINT_KIND, hash, opts);
        if (hint && hint.data.expiresAt > now && hint.data.state !== "rejected")
          return {
            state: "pending",
            status: "PENDING",
            txHash: hash,
            source: hint.source,
            ageMs: hint.ageMs,
            stale: hint.stale,
            reason: hint.data.reason,
            evidence: null,
            hint: hint.data.hint,
          };
        return {
          state: "empty",
          txHash: hash,
          evidence: null,
          reason: "No verified receipt or active hint recorded",
        };
      } catch (error) {
        if (error instanceof ToolError) throw error;
        console.warn("get_receipt snapshot lookup unavailable; details withheld");
        throw new ToolError("unavailable", "Receipt snapshot store is unavailable.");
      } finally {
        owned?.close();
      }
    },
  );
}
