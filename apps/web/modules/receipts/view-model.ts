export interface ReceiptsViewModel {
  state: "empty";
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string;
  error: string | null;
}

export async function loadReceipts(): Promise<ReceiptsViewModel> {
  return {
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Receipts has no observations yet.",
    error: null,
  };
}
