import { ModuleBoundary } from "@/components/module-boundary";
import { loadAutopilot } from "./view-model";

export function AutopilotPlain() {
  return (
    <ModuleBoundary
      module="autopilot"
      load={async () => {
        const vm = await loadAutopilot();
        return (
          <section aria-label="Autopilot">
            <p>{vm.reason}</p>
          </section>
        );
      }}
    />
  );
}
