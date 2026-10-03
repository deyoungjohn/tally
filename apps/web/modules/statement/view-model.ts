export interface StatementViewModel {
  state: "empty";
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string;
  error: string | null;
}

export async function loadStatement(): Promise<StatementViewModel> {
  return {
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Statement has no observations yet.",
    error: null,
  };
}
