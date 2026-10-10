"use client";
// Guardian from the guardian module's view models (`AlertFeedVM`, `GuardianSettingsVM`), reached through the session-verified
// routes `/api/session/guardian/*`. Guardian data is private: the page never puts an address in a URL; the server learns the
// wallet from the Privy access token and `x-tally-wallet` (see `useSessionFetch`). The settings are shown read-only: no route
// accepts a change yet, and the screen says so.

import {
  ArrowRight,
  Bell,
  BellOff,
  Check,
  Copy,
  ExternalLink,
  Link2,
  LogIn,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AlertFeedItemVM,
  AlertFeedVM,
  GuardianSettingsVM,
} from "@/modules/guardian/view-model";
import { Button, ButtonLink } from "@/components/motion/button";
import { Switch } from "@/components/motion/switch";
import { SuggestionsBlock } from "@/components/portfolio/suggestions";
import {
  VmEmpty,
  VmFreshness,
  VmSkeleton,
  ageText,
  type VmEnvelope,
} from "@/components/portfolio/vm-shared";
import { Tip } from "@/components/ui/tooltip";
import { heldQuery } from "@/lib/held";
import { useJson } from "@/lib/hooks/use-json";
import { useSessionFetch } from "@/lib/hooks/use-session-fetch";
import { useSessionJson, type SessionJson } from "@/lib/hooks/use-session-json";
import { tokenSymbol } from "@/lib/tickers";
import type { PortfolioReport } from "@tally/engine";
import type { PortfolioVM } from "@/modules/statement/view-model";

/** The Guardian bot's public Telegram username. */
export const GUARDIAN_BOT = "tallyguardianbot";
const BOT_URL = `https://t.me/${GUARDIAN_BOT}`;

/** Copies `text` and says so for two seconds. A blocked clipboard leaves the text selectable on screen. */
function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-glassy !h-9 !px-3 text-[13.5px]"
      aria-label={done ? `${label} copied` : `Copy ${label}`}
      data-testid={testId}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

const SEVERITY: Record<AlertFeedItemVM["severity"], { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "badge-amber" },
  warning: { label: "Warning", cls: "badge-amber" },
  info: { label: "Info", cls: "" },
};

const RULES: [keyof GuardianSettingsVM["settings"]["rules"], string, string][] = [
  ["paused", "Token paused", "An issuer pauses a token you hold."],
  ["shareCount", "Share count changes", "The number of shares one token represents changes."],
  ["gradeDrop", "Grade drops", "A token you hold falls to a lower grade on Radar."],
  [
    "ghost",
    "Thin Liquidity",
    "Trading activity on a token you hold drops to under $1,000 in 24 hours.",
  ],
  ["priceThreshold", "Price thresholds", "Market price crosses a limit you set."],
  ["earnings", "Earnings", "An issuer limits a token around earnings."],
];

/** Earnings alerts and Autopilot are not switchable yet; the tooltips say what they will do. */
const SOON_TIPS = {
  earnings:
    "Coming soon: a heads-up when an issuer limits trading on a token you hold around a company's earnings, so a pause never surprises you.",
  autopilot:
    "Coming soon: Autopilot can act on an alert for you, within limits you set. For example, it can sell a token that was just paused, even while you're offline. Every action is capped, you can switch it off at any time, and every decision it makes is shown to you.",
} as const;

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
        Guardian only shows alerts to the wallet that signed in, and our server could not confirm
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

function Feed({ state, hold }: { state: SessionJson<AlertFeedVM>; hold?: boolean }) {
  // Until we know whether the wallet holds anything, an empty feed is not an answer yet.
  if (hold && "data" in state && state.data?.state === "empty")
    return <VmSkeleton rows={2} label="Loading alerts" />;
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
              <p className="t-meta">1. Open the Tally bot in Telegram:</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <a
                  className="btn btn-primary !h-9 !px-4 text-[14px]"
                  href={BOT_URL}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="guardian-open-telegram"
                >
                  <ExternalLink size={14} aria-hidden /> Open @{GUARDIAN_BOT}
                </a>
                <CopyButton
                  text={`@${GUARDIAN_BOT}`}
                  label="bot username"
                  testId="guardian-copy-bot"
                />
              </div>
              <p className="t-meta mt-3">2. Send it this message:</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p
                  className="mono m-0 select-all text-[20px] font-bold tracking-wide"
                  data-testid="guardian-link-text"
                >
                  /link {t.activeLinkCode.code}
                </p>
                <CopyButton
                  text={`/link ${t.activeLinkCode.code}`}
                  label="link command"
                  testId="guardian-copy-link"
                />
              </div>
              <p className="t-meta mt-1">
                Valid for about {Math.max(1, Math.round(t.activeLinkCode.expiresInSeconds / 60))}{" "}
                minutes, once. This page updates by itself when the bot confirms.
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

function Settings({
  vm,
  onSave,
  saving,
  saveError,
}: {
  vm: GuardianSettingsVM;
  onSave: (next: GuardianSettingsVM["settings"]) => void;
  saving: boolean;
  saveError: string | null;
}) {
  const s = vm.settings;
  return (
    <section className="panel p-4" aria-label="Alert rules" data-testid="guardian-settings">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          {s.enabled ? <Bell size={16} aria-hidden /> : <BellOff size={16} aria-hidden />} Alert
          rules
        </p>
        <Switch
          checked={s.enabled}
          disabled={saving}
          ariaLabel="Guardian alerts"
          testId="guardian-switch-enabled"
          onCheckedChange={(enabled) => onSave({ ...s, enabled })}
        />
      </div>
      <p className="t-meta mt-1">
        Guardian is {s.enabled ? "on" : "off"}. Each switch applies as soon as you flip it.
      </p>
      <ul className="m-0 mt-3 grid list-none gap-2 p-0">
        {RULES.map(([key, label, tip]) => {
          const unavailable = key === "earnings";
          return (
            <li key={key} className="flex items-center justify-between gap-3 text-[14.5px]">
              <Tip text={unavailable ? SOON_TIPS.earnings : tip}>
                {label}
                {unavailable ? <span className="text-fg3"> · Soon</span> : null}
              </Tip>
              <Switch
                checked={s.rules[key]}
                disabled={saving || !s.enabled || unavailable}
                ariaLabel={label}
                testId={`guardian-switch-${key}`}
                onCheckedChange={(next) => onSave({ ...s, rules: { ...s.rules, [key]: next } })}
              />
            </li>
          );
        })}
        <li
          className="flex items-center justify-between gap-3 text-[14.5px]"
          data-testid="guardian-autopilot-soon"
        >
          <Tip text={SOON_TIPS.autopilot}>
            Autopilot <span className="text-fg3">· Soon</span>
          </Tip>
          <Switch
            checked={false}
            disabled
            ariaLabel="Autopilot (coming soon)"
            testId="guardian-switch-autopilot"
            onCheckedChange={() => undefined}
          />
        </li>
      </ul>
      {saveError ? (
        <p role="alert" className="mt-2 text-amber" data-testid="guardian-save-error">
          {saveError}
        </p>
      ) : null}
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

const polledLinked = (st: SessionJson<GuardianSettingsVM>) =>
  "data" in st && st.data?.telegram.linked === true;

export function GuardianScreen() {
  const { signedIn, ready, login, sessionFetch, address } = useSessionFetch();
  // Does the signed-in wallet hold any tokenized stock? Only a loaded answer that says "none" shows the nudge.
  const q = signedIn && address ? encodeURIComponent(address) : null;
  const held = useJson<Pick<PortfolioReport, "groups" | "failed">>(
    q ? `/api/portfolio?address=${q}` : null,
    { refreshMs: 60_000 },
  );
  const holdsNothing =
    held.data !== null && held.data.groups.length === 0 && held.data.failed.length === 0;
  // Asked at the same time as the holdings (not after them), so the suggestions are ready when the nudge appears.
  const portfolioVm = useJson<VmEnvelope<PortfolioVM>>(
    q && held.data ? `/api/vm/portfolio?address=${q}${heldQuery(held.data)}` : null,
  );
  const holdingsKnown = !q || held.data !== null || held.error !== null;
  const feed = useSessionJson<AlertFeedVM>("/api/session/guardian/feed", { refreshMs: 60_000 });
  // While a link code is on screen, look for the link every few seconds so the page notices when the bot confirms it.
  const [watching, setWatching] = useState(false);
  const settings = useSessionJson<GuardianSettingsVM>("/api/session/guardian/settings", {
    refreshMs: watching ? 4000 : undefined,
  });
  const [busy, setBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [issued, setIssued] = useState<GuardianSettingsVM | null>(null);
  const reloadSettings = settings.reload;
  // The answer to our last change, shown until a fresh read of the settings arrives.
  const [saved, setSaved] = useState<GuardianSettingsVM | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Give the wallet provider a moment to load before saying "signed out"; if it never does, say so rather than wait forever.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(id);
  }, []);

  const save = useCallback(
    async (next: GuardianSettingsVM["settings"]) => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await sessionFetch("/api/session/guardian/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        if (res === null || res.status === 401)
          setSaveError("We couldn't verify your sign-in. Sign in again.");
        else if (res.status === 429) setSaveError("Too many changes. Try again in a while.");
        else if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setSaveError(body?.error?.message ?? "Couldn't save that change.");
        } else {
          setSaved((await res.json()) as GuardianSettingsVM);
          reloadSettings();
        }
      } catch {
        setSaveError("Couldn't reach Tally.");
      } finally {
        setSaving(false);
      }
    },
    [sessionFetch, reloadSettings],
  );

  const getCode = useCallback(async () => {
    setBusy(true);
    setCodeError(null);
    try {
      const res = await sessionFetch("/api/session/guardian/link-code", { method: "POST" });
      if (res === null || res.status === 401)
        setCodeError("We couldn't verify your sign-in. Sign in again.");
      else if (res.status === 429) setCodeError("Too many codes requested. Try again in a while.");
      else if (!res.ok) setCodeError("Couldn't get a code right now.");
      else {
        setIssued((await res.json()) as GuardianSettingsVM);
        setWatching(true);
      }
    } catch {
      setCodeError("Couldn't reach Tally.");
    } finally {
      setBusy(false);
    }
  }, [sessionFetch]);

  // A fresh read replaces whatever we showed after our own change.
  const freshRead = settings.state.status === "ok" ? settings.state.data : null;
  useEffect(() => {
    if (freshRead) setSaved(null);
  }, [freshRead]);
  const isLinked = polledLinked(settings.state);
  useEffect(() => {
    if (isLinked) setWatching(false);
  }, [isLinked]);

  if (!ready && !signedIn && !waited) return <VmSkeleton rows={1} label="Loading" />;
  if (!signedIn)
    return (
      <section className="glass p-6" aria-label="Sign in" data-testid="guardian-signed-out">
        <h2 className="t-h3">Sign in to see your alerts</h2>
        <p className="mt-2 max-w-[60ch] text-fg2">
          Guardian watches the tokens in your wallet and alerts you about certain issues like a
          pause, a share count change, a grade drop, etc. Alerts are private to you, so you need to
          sign in to start receiving alerts.
        </p>
        <Button className="mt-4" onClick={login}>
          <LogIn size={16} aria-hidden /> Sign in
        </Button>
      </section>
    );
  if (feed.state.status === "unverified" || settings.state.status === "unverified")
    return <Unverified login={login} />;

  const polled =
    "data" in settings.state ? (settings.state.data as GuardianSettingsVM | null) : null;
  // A fresh read that says "linked" beats the code we issued earlier.
  const settingsVm = saved ?? (polled?.telegram.linked ? polled : (issued ?? polled));
  return (
    <div className="grid grid-cols-1 gap-6 min-[981px]:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        {holdsNothing ? (
          <section
            className="glass mb-6 p-6"
            aria-label="Buy your first token"
            data-testid="guardian-no-tokens"
          >
            <h2 className="t-h3">You don&apos;t hold any tokenized stocks yet</h2>
            <p className="mt-2 max-w-[60ch] text-fg2">
              Guardian watches the tokens in your wallet, so there is nothing to watch until you
              hold one. Buy your first and its alerts start working.
            </p>
            <ButtonLink href="/trade" className="mt-4" data-testid="guardian-buy-cta">
              Buy your first tokenized stock <ArrowRight size={16} aria-hidden />
            </ButtonLink>
            {portfolioVm.data === null && portfolioVm.error === null ? (
              <VmSkeleton rows={1} label="Loading suggestions" />
            ) : (
              <SuggestionsBlock suggestions={portfolioVm.data?.vm?.suggestions} />
            )}
          </section>
        ) : null}
        <h2 className="t-h3 mb-3">Alerts</h2>
        <Feed state={feed.state} hold={!holdingsKnown} />
      </div>
      <aside className="grid min-w-0 content-start gap-3">
        {settingsVm ? (
          <>
            <TelegramCard vm={settingsVm} onGetCode={getCode} busy={busy} codeError={codeError} />
            <Settings vm={settingsVm} onSave={save} saving={saving} saveError={saveError} />
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
