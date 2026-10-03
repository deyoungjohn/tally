export interface AutopilotViewModel {
  state: "empty";
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string;
  error: string | null;
}

export async function loadAutopilot(): Promise<AutopilotViewModel> {
  return {
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Autopilot has no observations yet.",
    error: null,
  };
}
