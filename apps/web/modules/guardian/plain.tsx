import { ModuleBoundary } from "@/components/module-boundary";
import { loadGuardian } from "./view-model";

export function GuardianPlain({
  walletAddress,
  issueNewLinkCode = false,
}: {
  walletAddress?: string;
  issueNewLinkCode?: boolean;
} = {}) {
  return (
    <ModuleBoundary
      module="guardian"
      load={async () => {
        const canIssueCode = process.env.NODE_ENV !== "production" && Boolean(issueNewLinkCode);
        const vm = await loadGuardian({
          walletAddress,
          issueNewLinkCode: canIssueCode,
        });

        if (vm.state === "error") {
          return (
            <section aria-label="Guardian Error">
              <h2>Guardian Error</h2>
              <p>{vm.error ?? "Failed to load Guardian module."}</p>
            </section>
          );
        }

        return (
          <div aria-label="Guardian Module">
            <section aria-label="Guardian Alert Feed">
              <header>
                <h2>Guardian Alerts</h2>
                <p>Wallet: {vm.feed.walletAddress ?? "Not connected"}</p>
                {vm.feed.stale && (
                  <p role="note" style={{ color: "orange" }}>
                    Notice: Alert feed data is stale ({vm.feed.ageMs} ms old)
                  </p>
                )}
              </header>

              {vm.feed.alerts.length === 0 ? (
                <p>{vm.feed.reason ?? "No alerts triggered for your holdings."}</p>
              ) : (
                <ul aria-label="Alert List">
                  {vm.feed.alerts.map((alert) => (
                    <li key={alert.id} style={{ marginBottom: "1rem" }}>
                      <article>
                        <header>
                          <strong>
                            [{alert.severity.toUpperCase()}] {alert.title}
                          </strong>
                          <time dateTime={new Date(alert.createdAt).toISOString()}>
                            {" "}
                            · {alert.createdAtFormatted}
                          </time>
                        </header>
                        <p>{alert.body}</p>
                        <footer>
                          <small>
                            Evidence: {alert.evidence.snapshotKind} snapshot (
                            {alert.evidence.snapshotKey})
                          </small>
                        </footer>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <hr style={{ margin: "2rem 0" }} />

            <section aria-label="Guardian Settings">
              <header>
                <h2>Guardian Settings</h2>
              </header>

              <div>
                <h3>Telegram Alerts</h3>
                {vm.settings.telegram.linked ? (
                  <p>
                    ✅ Telegram linked (Chat ID: {vm.settings.telegram.chatId}) · Alerts:{" "}
                    <strong>{vm.settings.telegram.alertsEnabled ? "ON" : "OFF"}</strong>
                  </p>
                ) : (
                  <div>
                    <p>⚠️ Telegram not linked.</p>
                    {vm.settings.telegram.activeLinkCode ? (
                      <p>
                        One-Time Link Code: <code>{vm.settings.telegram.activeLinkCode.code}</code>{" "}
                        (expires in {vm.settings.telegram.activeLinkCode.expiresInSeconds}s).
                        <br />
                        Send <code>/link {vm.settings.telegram.activeLinkCode.code}</code> to the
                        Telegram bot.
                      </p>
                    ) : (
                      <p>Generate a link code to connect Telegram alerts.</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h3>Active Rules</h3>
                <ul>
                  <li>
                    Paused / Halted: {vm.settings.settings.rules.paused ? "Enabled" : "Disabled"}
                  </li>
                  <li>
                    Share Count Changed:{" "}
                    {vm.settings.settings.rules.shareCount ? "Enabled" : "Disabled"}
                  </li>
                  <li>
                    Grade Drop: {vm.settings.settings.rules.gradeDrop ? "Enabled" : "Disabled"}
                  </li>
                  <li>
                    Ghost / No Exit: {vm.settings.settings.rules.ghost ? "Enabled" : "Disabled"}
                  </li>
                  <li>
                    Price Thresholds:{" "}
                    {vm.settings.settings.rules.priceThreshold ? "Enabled" : "Disabled"}
                  </li>
                  <li>Earnings: Disabled (Gate V-E: No free reliable earnings source confirmed)</li>
                </ul>
              </div>

              <div>
                <h3>Quiet Hours</h3>
                {vm.settings.settings.quietHours?.enabled ? (
                  <p>
                    Enabled: {vm.settings.settings.quietHours.startHourUtc}:00 to{" "}
                    {vm.settings.settings.quietHours.endHourUtc}:00 UTC
                  </p>
                ) : (
                  <p>Disabled</p>
                )}
              </div>
            </section>
          </div>
        );
      }}
    />
  );
}
