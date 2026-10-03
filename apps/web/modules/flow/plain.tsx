import { ModuleBoundary } from "@/components/module-boundary";
import { loadFlow } from "./view-model";

export function FlowPlain() {
  return (
    <ModuleBoundary
      module="flow"
      load={async () => {
        const vm = await loadFlow();
        return (
          <section aria-label="Flow">
            <p>{vm.reason}</p>
          </section>
        );
      }}
    />
  );
}
