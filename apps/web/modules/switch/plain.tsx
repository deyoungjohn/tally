import { ModuleBoundary } from "@/components/module-boundary";
import { loadSellSheet, loadSwitchSheet, loadSwitch } from "./view-model";

export function SwitchPlain() {
  return (
    <ModuleBoundary
      module="switch"
      load={async () => {
        const [vm, sellVm, switchVm] = await Promise.all([
          loadSwitch(),
          loadSellSheet(),
          loadSwitchSheet(),
        ]);
        return (
          <section aria-label="Sell and Switch">
            <header>
              <h2>Sell & Switch Issuer</h2>
              <p>{vm.reason}</p>
            </header>

            <article aria-label="Sell Sheet Preview">
              <h3>Sell to USDT</h3>
              <p>State: {sellVm.state}</p>
              <p>Reason: {sellVm.availabilityReason ?? "Ready"}</p>
            </article>

            <article aria-label="Switch Sheet Preview">
              <h3>Switch Issuer</h3>
              <p>State: {switchVm.state}</p>
              <p>Reason: {switchVm.availabilityReason ?? "Ready"}</p>
            </article>
          </section>
        );
      }}
    />
  );
}
