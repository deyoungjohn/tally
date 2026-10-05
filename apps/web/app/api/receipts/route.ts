import { openStore } from "@tally/modkit";
import { getEngine } from "../../../lib/server/engine";
import { createReceiptPost } from "../../../modules/receipts/ingestion";
let store: ReturnType<typeof openStore> | undefined;
export const POST = createReceiptPost({
  trustedOrigin: process.env.TALLY_APP_ORIGIN,
  enabled: () => process.env.FEATURE_RECEIPTS === "1",
  engine: getEngine,
  store: () => (store ??= openStore()),
  now: Date.now,
  onWarn: (m) => console.warn(m),
});
