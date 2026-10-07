import { ModuleBoundary } from "@/components/module-boundary";
import { loadMigrateSheet, loadMigrate } from "./view-model";

export function MigratePlain() {
  return (
    <ModuleBoundary
      module="switch"
      load={async () => {
        const [vm, migrateVm] = await Promise.all([loadMigrate(), loadMigrateSheet()]);
        return (
          <section aria-label="Migrate Issuer">
            <header>
              <h2>Migrate Issuer</h2>
              <p>{vm.reason}</p>
            </header>

            <article aria-label="Migrate Sheet Preview">
              <h3>Migrate to {migrateVm.toIssuer}</h3>
              <p>State: {migrateVm.state}</p>
              <p>Reason: {migrateVm.availabilityReason ?? "Ready"}</p>
            </article>
          </section>
        );
      }}
    />
  );
}
