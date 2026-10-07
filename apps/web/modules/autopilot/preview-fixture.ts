import { openStore } from "@tally/modkit";
import { appendDecisionRows } from "@tally/mod-autopilot";
import {
  constructedPolicy,
  constructedPosition,
  CONSTRUCTED_TOKEN,
  constructedRow,
  CONSTRUCTED_NOW,
  CONSTRUCTED_WALLET,
} from "../../../../packages/mod-autopilot/src/fixtures";
import { loadAutopilot } from "./view-model";

/** Constructed data, never claims a real wallet observation or execution. */
export async function previewAutopilot() {
  const store = openStore(":memory:");
  try {
    store.put({
      kind: "autopilot-policy",
      key: CONSTRUCTED_WALLET,
      data: constructedPolicy(),
      source: "constructed preview",
      observedAt: CONSTRUCTED_NOW,
    });
    store.put({
      kind: "autopilot-position",
      key: `${CONSTRUCTED_WALLET}:${CONSTRUCTED_TOKEN}`,
      data: constructedPosition(),
      source: "constructed preview",
      observedAt: CONSTRUCTED_NOW,
    });
    store.put({
      kind: "autopilot-collector",
      key: CONSTRUCTED_WALLET,
      data: { positionKeys: [`${CONSTRUCTED_WALLET}:${CONSTRUCTED_TOKEN}`] },
      source: "constructed preview",
      observedAt: CONSTRUCTED_NOW,
    });
    appendDecisionRows(store, [constructedRow()], CONSTRUCTED_NOW);
    const vm = await loadAutopilot({
      walletAddress: CONSTRUCTED_WALLET,
      store,
      now: CONSTRUCTED_NOW + 600_000,
    });
    return {
      ...vm,
      source: "constructed preview",
      reason: "Constructed preview data; no real observations or execution.",
    };
  } finally {
    store.close();
  }
}
