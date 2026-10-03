import "server-only";
import { flags } from "@tally/config";

export function moduleFlags() {
  return flags(process.env);
}
