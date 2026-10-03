export interface GuardianViewModel {
  state: "empty";
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string;
  error: string | null;
}

export async function loadGuardian(): Promise<GuardianViewModel> {
  return {
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Guardian has no observations yet.",
    error: null,
  };
}
