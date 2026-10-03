import { ModuleBoundary } from "@/components/module-boundary";
import { loadGuardian } from "./view-model";

export function GuardianPlain() {
  return (
    <ModuleBoundary
      module="guardian"
      load={async () => {
        const vm = await loadGuardian();
        return (
          <section aria-label="Guardian">
            <p>{vm.reason}</p>
          </section>
        );
      }}
    />
  );
}
