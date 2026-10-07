import { AutopilotContent } from "./content";
export { AutopilotContent } from "./content";
import { openStore } from "@tally/modkit";
import { ModuleBoundary } from "@/components/module-boundary";
import { loadAutopilot, type AutopilotVM } from "./view-model";

export function AutopilotPlain({
  walletAddress,
  vm,
}: { walletAddress?: string; vm?: AutopilotVM } = {}) {
  return (
    <ModuleBoundary
      module="autopilot"
      fallback={vm ? <AutopilotContent vm={vm} /> : undefined}
      load={async (health) => {
        if (vm) return <AutopilotContent vm={vm} />;
        const store = openStore();
        try {
          return (
            <AutopilotContent
              vm={await loadAutopilot({ walletAddress, store, health, onWarn: console.warn })}
            />
          );
        } finally {
          store.close();
        }
      }}
    />
  );
}
