import { ModuleBoundary } from "@/components/module-boundary";
import { loadReceipts } from "./view-model";

export function ReceiptsPlain() {
  return (
    <ModuleBoundary
      module="receipts"
      load={async () => {
        const vm = await loadReceipts();
        return (
          <section aria-label="Receipts">
            <p>{vm.reason}</p>
          </section>
        );
      }}
    />
  );
}
