import { ModuleBoundary } from "@/components/module-boundary";
import { loadQuality } from "./view-model";

export function QualityPlain() {
  return (
    <ModuleBoundary
      module="quality"
      load={async () => {
        const vm = await loadQuality();
        return (
          <section aria-label="Quality">
            <p>{vm.reason}</p>
          </section>
        );
      }}
    />
  );
}
