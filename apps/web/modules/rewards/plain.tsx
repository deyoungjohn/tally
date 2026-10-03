import { ModuleBoundary } from "@/components/module-boundary";
import { loadRewards } from "./view-model";

export function RewardsPlain() {
  return (
    <ModuleBoundary
      module="rewards"
      load={async () => {
        const vm = await loadRewards();
        return (
          <section aria-label="Rewards">
            <p>{vm.reason}</p>
          </section>
        );
      }}
    />
  );
}
