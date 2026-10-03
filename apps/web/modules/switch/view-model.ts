export interface SwitchViewModel {
  state: "empty";
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string;
  error: string | null;
}

export async function loadSwitch(): Promise<SwitchViewModel> {
  return {
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Switch has no observations yet.",
    error: null,
  };
}
