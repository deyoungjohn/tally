"use client";
// Guardian from the guardian module's view models (`AlertFeedVM`, `GuardianSettingsVM`), reached through the session-verified
// routes `/api/session/guardian/*`. Guardian data is private: the page never puts an address in a URL; the server learns the
// wallet from the Privy access token and `x-tally-wallet` (see `useSessionFetch`). The settings are shown read-only: no route
// accepts a change yet, and the screen says so.

import { Bell, BellOff, Link2, LogIn, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AlertFeedItemVM,
  AlertFeedVM,
  GuardianSettingsVM,
} from "@/modules/guardian/view-model";
import { Button, ButtonLink } from "@/components/motion/button";
import { VmEmpty, VmFreshness, VmSkeleton, ageText } from "@/components/portfolio/vm-shared";
import { Tip } from "@/components/ui/tooltip";
import { useSessionFetch } from "@/lib/hooks/use-session-fetch";
import { useSessionJson, type SessionJson } from "@/lib/hooks/use-session-json";
import { tokenSymbol } from "@/lib/tickers";

const SEVERITY: Record<AlertFeedItemVM["severity"], { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "badge-amber" },
  warning: { label: "Warning", cls: "badge-amber" },
  info: { label: "Info", cls: "" },
};

const RULES: [keyof GuardianSettingsVM["settings"]["rules"], string, string][] = [
  ["paused", "Token paused", "An issuer pauses a token you hold."],
  ["shareCount", "Share count changes", "The number of shares one token represents changes."],
  ["gradeDrop", "Grade drops", "A token you hold falls to a lower Radar grade."],
  ["ghost", "Not Tradable", "A token you hold stops trading (under $1,000 in 24 hours)."],
  ["priceThreshold", "Price thresholds", "A price crosses a limit you set."],
  ["earnings", "Earnings", "An issuer limits a token around earnings."],
];

function Unverified({ login }: { login: () => void }) {
  return (
    <section
      role="status"
      className="glass p-6"
      aria-label="Sign-in not verified"
      data-testid="guardian-unverified"
    >
      <p className="flex items-center gap-2 font-semibold">
        <ShieldAlert size={18} className="text-amber" aria-hidden /> We couldn&apos;t verify your
        sign-in
      </p>
      <p className="mt-2 text-fg2">
        Guardian only shows alerts to the wallet that signed in, and the server could not confirm
        that. Sign in again to continue.
      </p>
      <Button className="mt-4" onClick={login}>
        <LogIn size={16} aria-hidden /> Sign in again
      </Button>
    </section>
  );
}

function Alert({ a }: { a: AlertFeedItemVM }) {
  const sev = SEVERITY[a.severity];
  return (
    <li className="panel list-none p-4" data-testid={`guardian-alert-${a.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          {a.title}{" "}
          <span className="mono text-[13px] font-normal text-fg3">
            {tokenSymbol(a.ticker, a.issuer)}
          </span>
        </p>
        <span className={`badge ${sev.cls}`}>{sev.label}</span>
      </div>
      <p className="mt-1 text-[14.5px] text-fg2">{a.body}</p>
      <p className="t-meta mt-2">
        {a.createdAtFormatted} · from a {a.evidence.snapshotKind} reading taken{" "}
        {new Date(a.evidence.observedAt).toUTCString()}
      </p>
    </li>
  );
}

function Feed({ state }: { state: SessionJson<AlertFeedVM> }) {
  if (state.status === "loading" && !state.data)
    return <VmSkeleton rows={2} label="Loading alerts" />;
  if (state.status === "error" && !state.data)
    return (
      <p role="alert" className="text-amber">
        {state.message}
      </p>
    );
  const vm = "data" in state ? state.data : null;
  if (!vm) return null;
  if (vm.state === "error")
    return (
      <p role="alert" className="text-amber" data-testid="guardian-feed-error">
        {vm.reason ?? vm.error ?? "Alerts couldn't load."}
      </p>
    );
  if (vm.state === "empty")
    return (
      <VmEmpty
        title="No alerts"
        reason={vm.reason ?? "No alerts have been triggered for your holdings."}
      />
    );
  return (
    <>
      <VmFreshness stale={vm.stale} ageMs={vm.ageMs} source={vm.source} fixtures={false} />
      <ul className="m-0 mt-3 grid list-none gap-3 p-0" data-testid="guardian-feed">
        {vm.alerts.map((a) => (
          <Alert key={a.id} a={a} />
        ))}
      </ul>
    </>
  );
}

function TelegramCard({
  vm,
  onGetCode,
  busy,
  codeError,
}: {
  vm: GuardianSettingsVM;
  onGetCode: () => void;
  busy: boolean;
  codeError: string | null;
}) {
  const t = vm.telegram;
  return (
    <section className="panel p-4" aria-label="Telegram" data-testid="guardian-telegram">
      <p className="flex items-center gap-2 font-semibold">
        <Link2 size={16} aria-hidden /> Telegram
      </p>
      {t.linked ? (
        <p className="mt-2 text-fg2" data-testid="guardian-linked">
          Linked. Alerts to Telegram are {t.alertsEnabled ? "on" : "off"}.
        </p>
      ) : (
        <>
          <p className="mt-2 text-fg2" data-testid="guardian-not-linked">
            Telegram isn&apos;t linked to this wallet, so alerts only appear here.
          </p>
          {t.activeLinkCode ? (
            <div className="mt-3" data-testid="guardian-link-code">
              {process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ? (
                <>
                  <p className="t-meta">Send this to the Tally bot in Telegram:</p>
                  <p className="mono mt-1 text-[20px] font-bold tracking-wide">
                    /link {t.activeLinkCode.code}
                  </p>
                  <ButtonLink
                    href={`https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="glassy"
                    className="mt-2"
                  >
                    Open
                  </ButtonLink>
                </>
              ) : (
                <>
                  <p className="t-meta">Open the Tally bot in Telegram and send /link CODE</p>
                  <p className="mono mt-1 text-[20px] font-bold tracking-wide">
                    /link {t.activeLinkCode.code}
                  </p>
                </>
              )}
              <p className="t-meta mt-1">
                Valid for about {Math.max(1, Math.round(t.activeLinkCode.expiresInSeconds / 60))}{" "}
                minutes, once.
              </p>
            </div>
          ) : (
            <Button className="mt-3" variant="glassy" onClick={onGetCode} disabled={busy}>
              {busy ? "Getting a code…" : "Get a link code"}
            </Button>
          )}
          {codeError ? (
            <p role="alert" className="mt-2 text-amber">
              {codeError}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function Settings({ vm }: { vm: GuardianSettingsVM }) {
  const s = vm.settings;
  return (
    <section className="panel p-4" aria-label="Alert rules" data-testid="guardian-settings">
      <p className="flex items-center gap-2 font-semibold">
        {s.enabled ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />} Alert rules
      </p>
      <p className="t-meta mt-1">
        Guardian is {s.enabled ? "on" : "off"}. Changing these here isn&apos;t available yet.
      </p>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0">
        {RULES.map(([key, label, tip]) => (
          <li key={key} className="flex items-center justify-between gap-3 text-[14.5px]">
            <Tip text={tip}>{label}</Tip>
            <span className={s.rules[key] ? "text-fg" : "text-fg3"}>
              {s.rules[key] ? "On" : "Off"}
            </span>
          </li>
        ))}
      </ul>
      {s.quietHours?.enabled ? (
        <p className="t-meta mt-3">
          Quiet hours (UTC): {String(s.quietHours.startHourUtc).padStart(2, "0")}:00 to{" "}
          {String(s.quietHours.endHourUtc).padStart(2, "0")}:00
        </p>
      ) : null}
      {vm.stale ? (
        <p className="t-meta mt-2 text-amber" role="status">
          Settings last read {ageText(vm.ageMs) ?? "a while ago"}.
        </p>
      ) : null}
    </section>
  );
}

export function GuardianScreen() {
  const { signedIn, ready, login, sessionFetch } = useSessionFetch();
  const feed = useSessionJson<AlertFeedVM>("/api/session/guardian/feed", { refreshMs: 60_000 });
  const settings = useSessionJson<GuardianSettingsVM>("/api/session/guardian/settings");
  const [busy, setBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [issued, setIssued] = useState<GuardianSettingsVM | null>(null);
  // Give the wallet provider a moment to load before saying "signed out"; if it never does, say so rather than wait forever.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(id);
  }, []);

  const getCode = useCallback(async () => {
    setBusy(true);
    setCodeError(null);
    try {
      const res = await sessionFetch("/api/session/guardian/link-code", { method: "POST" });
      if (res === null || res.status === 401)
        setCodeError("We couldn't verify your sign-in. Sign in again.");
      else if (res.status === 429) setCodeError("Too many codes requested. Try again in a while.");
      else if (!res.ok) setCodeError("Couldn't get a code right now.");
      else setIssued((await res.json()) as GuardianSettingsVM);
    } catch {
      setCodeError("Couldn't reach Tally.");
    } finally {
      setBusy(false);
    }
  }, [sessionFetch]);

  if (!ready && !signedIn && !waited) return <VmSkeleton rows={1} label="Loading" />;
  if (!signedIn)
    return (
      <section className="glass p-6" aria-label="Sign in" data-testid="guardian-signed-out">
        <h2 className="t-h3">Sign in to see your alerts</h2>
        <p className="mt-2 max-w-[60ch] text-fg2">
          Guardian watches the tokens in your wallet and tells you about problems: a pause, a share
          count change, a grade drop. Alerts are private to you, so they need a sign-in.
        </p>
        <Button className="mt-4" onClick={login}>
          <LogIn size={16} aria-hidden /> Sign in
        </Button>
      </section>
    );
  if (feed.state.status === "unverified" || settings.state.status === "unverified")
    return <Unverified login={login} />;

  const settingsVm =
    issued ??
    ("data" in settings.state ? (settings.state.data as GuardianSettingsVM | null) : null);
  return (
    <div className="grid grid-cols-1 gap-6 min-[981px]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <h2 className="t-h3 mb-3">Alerts</h2>
        <Feed state={feed.state} />
      </div>
      <aside className="grid min-w-0 content-start gap-3">
        {settingsVm ? (
          <>
            <TelegramCard vm={settingsVm} onGetCode={getCode} busy={busy} codeError={codeError} />
            <Settings vm={settingsVm} />
          </>
        ) : settings.state.status === "error" ? (
          <p role="alert" className="text-amber">
            {settings.state.message}
          </p>
        ) : (
          <VmSkeleton rows={2} label="Loading settings" />
        )}
      </aside>
    </div>
  );
}
