import { ModuleBoundary } from "@/components/module-boundary";
import { loadPies } from "./view-model";

export function PiesPlain() {
  return (
    <ModuleBoundary
      module="pies"
      load={async () => {
        const vm = await loadPies();
        return (
          <section aria-label="Pies">
            <p>{vm.reason}</p>
          </section>
        );
      }}
    />
  );
}
