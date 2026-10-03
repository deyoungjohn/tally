import { ModuleBoundary } from "@/components/module-boundary";
import { loadSwitch } from "./view-model";

export function SwitchPlain() {
  return (
    <ModuleBoundary
      module="switch"
      load={async () => {
        const vm = await loadSwitch();
        return (
          <section aria-label="Switch">
            <p>{vm.reason}</p>
          </section>
        );
      }}
    />
  );
}
