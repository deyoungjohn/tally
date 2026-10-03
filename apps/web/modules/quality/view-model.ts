export interface QualityViewModel {
  state: "empty";
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string;
  error: string | null;
}

export async function loadQuality(): Promise<QualityViewModel> {
  return {
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Quality has no observations yet.",
    error: null,
  };
}
