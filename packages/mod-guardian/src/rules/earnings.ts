import type { Alert, TokenState, UserHolding } from "../types";
import { type Rule, type RulePorts } from "./interface";

export class EarningsRule implements Rule {
  readonly id = "earnings";
  readonly name = "Upcoming Earnings Announcement";
  readonly description = "Alerts before scheduled company earnings releases.";
  readonly disabled = true;
  readonly disabledReason = "Gate V-E: No free reliable earnings source confirmed";

  evaluate(
    _prev: TokenState | null,
    _next: TokenState,
    _holding: UserHolding,
    _ports?: RulePorts,
  ): Alert[] {
    // Disabled rule stub pending confirmed source at Gate V-E
    return [];
  }
}
