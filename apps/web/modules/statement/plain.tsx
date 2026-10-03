import { ModuleBoundary } from "@/components/module-boundary";
import { loadStatement } from "./view-model";

export function StatementPlain() {
  return (
    <ModuleBoundary
      module="statement"
      load={async () => {
        const vm = await loadStatement();
        return (
          <section aria-label="Statement">
            <p>{vm.reason}</p>
          </section>
        );
      }}
    />
  );
}
