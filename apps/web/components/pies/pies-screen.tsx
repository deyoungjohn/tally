"use client";
// The Pies page: choose a basket, set a budget and a weight per stock, review, then buy the stocks one after another through
// the guarantee. Built from the basket view model (`buildPiesPageVM`) and the run hook (`usePieRun`); no engine calls.

import { Check, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseDecimal } from "@tally/core";
import { Button } from "@/components/motion/button";
import { Modal } from "@/components/motion/modal";
import { PercentSlider } from "@/components/ui/percent-slider";
import { TokenIcon } from "@/components/ui/token-icon";
import { Tip } from "@/components/ui/tooltip";
import { VmEmpty, VmFreshness } from "@/components/portfolio/vm-shared";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { cn } from "@/lib/utils";
import { buildPiesPageVM, type BasketVM, type PiesPageVM } from "@/modules/pies/basket-view-model";
import { bpsToPercent, equalWeights, normaliseWeights, percentToBps } from "./pie-weights";
import { PiesProgress } from "./pies-progress";
import { usePerShareE18 } from "./use-basket-prices";
import { usePieRun } from "./use-pie-run";

/** A leg of the plan as the view model serialises it (the type of `plan.legs` is an intersection that hides the share fields). */
interface PlanLeg {
  id: string;
  ticker: string;
  symbol: string;
  amountUsdt: string;
  executable: boolean;
  reason: string | null;
  approximateSharesE18: string | null;
}
const MAX_LEG_USDT = 10_000n * 10n ** 18n;
const BUDGET_SLIDER_MAX = 1_000;
const money = (e18: string | bigint, d = 2) => formatUnits(BigInt(e18), 18, d);

const initialWeights = (basket: BasketVM | undefined): Record<string, string> =>
  Object.fromEntries((basket?.tokens ?? []).map((t) => [t.ticker, bpsToPercent(t.weightBps)]));

/** Whole-dollar budgets and cents only; five digits at most. */
const budgetOf = (text: string): bigint | null =>
  /^\d{1,5}(\.\d{0,2})?$/.test(text.trim()) ? parseDecimal(text.trim(), 18) : null;

export function PiesScreen({ initial }: { initial: PiesPageVM }) {
  const wallet = useTallyWallet();
  const flow = usePieRun({ fixtures: initial.fixtures });
  const [basketId, setBasketId] = useState(
    initial.selectedBasketId ?? initial.baskets[0]?.id ?? "",
  );
  const basket = initial.baskets.find((b) => b.id === basketId) ?? initial.baskets[0];
  const [budget, setBudget] = useState("30");
  const [weights, setWeights] = useState<Record<string, string>>(() => initialWeights(basket));
  const [reviewing, setReviewing] = useState(false);

  // A different basket starts from its own weights.
  useEffect(() => setWeights(initialWeights(basket)), [basket]);

  const tickers = useMemo(
    () => (basket?.tokens ?? []).filter((t) => t.executable).map((t) => t.ticker),
    [basket],
  );
  const prices = usePerShareE18(tickers);

  const parsed = useMemo(() => {
    const bps: Record<string, number> = {};
    let valid = true;
    for (const t of basket?.tokens ?? []) {
      const v = percentToBps(weights[t.ticker] ?? "");
      if (v === null) valid = false;
      bps[t.ticker] = v ?? 0;
    }
    const total = Object.values(bps).reduce((a, b) => a + b, 0);
    return { bps, valid, total };
  }, [weights, basket]);
  const budgetUsdt = budgetOf(budget);
  const weightsOk = parsed.valid && parsed.total === 10_000;

  const vm = useMemo(() => {
    if (!basket) return initial;
    try {
      return buildPiesPageVM({
        pieId: basket.id,
        budgetUsdt: budgetUsdt !== null && weightsOk ? budgetUsdt : undefined,
        weightsBps: weightsOk ? parsed.bps : undefined,
        pricesE18: prices,
        fixtures: initial.fixtures,
        meta: {
          stale: initial.stale,
          ageMs: initial.ageMs,
          source: initial.source,
          error: initial.error,
        },
        run: flow.run,
        wallet: wallet.address ?? undefined,
      });
    } catch {
      return initial;
    }
  }, [basket, budgetUsdt, weightsOk, parsed.bps, prices, initial, flow.run, wallet.address]);
  const plan = vm.plan;
  const legs = (plan?.legs ?? []) as unknown as PlanLeg[];
  const minBudget = basket ? Number(money(basket.minimumBudgetUsdt, 2)) : 6;
  const runActive = flow.run !== null;

  if (initial.empty || !basket)
    return (
      <VmEmpty title="No baskets yet" reason={initial.reason ?? "No baskets are available."} />
    );

  const executableLegs = legs.filter((l) => l.executable);
  const overLimit = executableLegs.some((l) => BigInt(l.amountUsdt) > MAX_LEG_USDT);
  const blocker = !wallet.authenticated
    ? null
    : !flow.ready
      ? "Basket buying is not available right now."
      : budgetUsdt === null
        ? "Enter a budget in dollars, for example 30."
        : !parsed.valid
          ? "A weight is not a valid percent."
          : !weightsOk
            ? `The weights total ${bpsToPercent(parsed.total)}%. They must total 100%.`
            : executableLegs.length === 0
              ? (plan?.reason ?? "No stock in this basket can be bought with this budget.")
              : overLimit
                ? "A single buy can be at most $10,000. Lower the budget or spread the weights."
                : null;
  const canStart = wallet.authenticated && blocker === null && plan !== null;

  return (
    <div className="grid gap-6" data-testid="pies-screen">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <VmFreshness
          stale={initial.stale}
          ageMs={initial.ageMs}
          source={initial.source}
          fixtures={initial.fixtures}
        />
      </div>

      {runActive && flow.run ? (
        <PiesProgress
          run={flow.run}
          canContinue={flow.canContinue}
          onContinue={() => void flow.continueRemaining()}
          onClear={() => flow.clear()}
          error={flow.error}
        />
      ) : (
        <>
          <section aria-label="Baskets">
            <h2 className="t-h3">Choose a basket</h2>
            <div
              role="radiogroup"
              aria-label="Baskets"
              className="mt-3 grid grid-cols-1 gap-3 min-[761px]:grid-cols-2"
            >
              {initial.baskets.map((b) => {
                const selected = b.id === basket.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setBasketId(b.id)}
                    data-testid={`basket-${b.id}`}
                    className={cn(
                      "glass min-w-0 p-5 text-left transition-colors",
                      selected && "!border-[var(--hl-edge)] !bg-[var(--hl-soft)]",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="t-h3">{b.name}</span>
                      {selected ? (
                        <Check size={18} style={{ color: "var(--orange-text)" }} aria-hidden />
                      ) : null}
                    </span>
                    <span className="mt-1 block text-fg2">{b.description}</span>
                    <span className="mt-3 flex flex-wrap gap-2">
                      {b.tokens.map((t) => (
                        <span
                          key={t.symbol}
                          className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[14px]"
                          data-testid={`chip-${t.symbol}`}
                        >
                          <TokenIcon ticker={t.ticker} size={16} />
                          <span className="font-semibold">{t.symbol}</span>
                          {t.executable ? null : (
                            <Tip text={t.reason ?? "Not enabled yet"} focusable={false}>
                              <span className="text-fg3">Not enabled yet</span>
                            </Tip>
                          )}
                        </span>
                      ))}
                    </span>
                    <span className="t-meta mt-3 block">
                      Minimum budget ${money(b.minimumBudgetUsdt, 0)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section
            className="glass p-5 min-[561px]:p-6"
            aria-label="Your basket"
            data-testid="pies-builder"
          >
            <h2 className="t-h3">{basket.name}: budget and weights</h2>

            <div className="mt-4 grid gap-1">
              <label htmlFor="pies-budget" className="font-semibold">
                Budget (USDT)
              </label>
              <input
                id="pies-budget"
                data-testid="pies-budget"
                className="input num max-w-[220px]"
                inputMode="decimal"
                autoComplete="off"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                aria-invalid={budgetUsdt === null}
              />
              <input
                type="range"
                aria-label="Budget slider"
                data-testid="pies-budget-slider"
                min={Math.ceil(minBudget)}
                max={Math.max(BUDGET_SLIDER_MAX, Math.ceil(minBudget))}
                step={1}
                value={Math.min(
                  Math.max(Math.round(Number(budget) || 0), Math.ceil(minBudget)),
                  Math.max(BUDGET_SLIDER_MAX, Math.ceil(minBudget)),
                )}
                onChange={(e) => setBudget(e.target.value)}
                className="pct-slider mt-2 max-w-[420px]"
                style={
                  {
                    "--p": `${
                      ((Math.min(Math.max(Number(budget) || 0, minBudget), BUDGET_SLIDER_MAX) -
                        minBudget) /
                        Math.max(1, BUDGET_SLIDER_MAX - minBudget)) *
                      100
                    }%`,
                  } as React.CSSProperties
                }
              />
              <p className="t-meta">
                Minimum ${money(basket.minimumBudgetUsdt, 0)} for this basket. Each stock needs at
                least $6.
              </p>
            </div>

            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Weight per stock</h3>
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant="glassy"
                    onClick={() => {
                      const eq = equalWeights(tickers);
                      setWeights(
                        Object.fromEntries(
                          basket.tokens.map((t) => [t.ticker, bpsToPercent(eq[t.ticker] ?? 0)]),
                        ),
                      );
                    }}
                    data-testid="pies-equal"
                  >
                    Equal
                  </Button>
                  <Button
                    variant="glassy"
                    disabled={weightsOk || !parsed.valid}
                    onClick={() => {
                      const n = normaliseWeights(parsed.bps);
                      if (n)
                        setWeights(
                          Object.fromEntries(
                            basket.tokens.map((t) => [t.ticker, bpsToPercent(n[t.ticker] ?? 0)]),
                          ),
                        );
                    }}
                    data-testid="pies-normalise"
                  >
                    Make it 100%
                  </Button>
                </span>
              </div>
              <ul className="m-0 mt-3 grid list-none gap-3 p-0">
                {basket.tokens.map((t) => {
                  const bps = parsed.bps[t.ticker] ?? 0;
                  return (
                    <li
                      key={t.symbol}
                      className="panel grid gap-2 p-3"
                      data-testid={`weight-${t.ticker}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <TokenIcon ticker={t.ticker} size={24} />
                          <span className="font-semibold">{t.symbol}</span>
                          {t.executable ? null : <span className="t-meta">Not enabled yet</span>}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <input
                            aria-label={`Weight ${t.symbol} %`}
                            className="input num !h-10 w-[84px] text-right"
                            inputMode="decimal"
                            autoComplete="off"
                            value={weights[t.ticker] ?? ""}
                            onChange={(e) => setWeights({ ...weights, [t.ticker]: e.target.value })}
                            aria-invalid={percentToBps(weights[t.ticker] ?? "") === null}
                          />
                          <span aria-hidden>%</span>
                        </span>
                      </div>
                      <PercentSlider
                        value={bps / 100}
                        onChange={(p) => setWeights({ ...weights, [t.ticker]: String(p) })}
                        label={`${t.symbol} weight`}
                        testId={`weight-slider-${t.ticker}`}
                      />
                    </li>
                  );
                })}
              </ul>
              <p
                role="status"
                className={cn("mt-3 font-semibold", weightsOk ? "text-up" : "text-red")}
                data-testid="pies-total"
              >
                Total {parsed.valid ? bpsToPercent(parsed.total) : "–"}%
                {weightsOk ? "" : ": must be 100%"}
              </p>
            </div>

            {plan ? (
              <div className="mt-6" data-testid="pies-preview">
                <h3 className="font-semibold">What you would buy</h3>
                <ul className="m-0 mt-3 grid list-none gap-2 p-0">
                  {legs.map((leg) => (
                    <li
                      key={leg.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5"
                      data-testid={`preview-${leg.ticker}`}
                    >
                      <span className="font-semibold">{leg.symbol}</span>
                      {leg.executable ? (
                        <span className="num text-right">
                          ${money(leg.amountUsdt)}
                          <span className="text-fg2">
                            {" "}
                            ·{" "}
                            {leg.approximateSharesE18
                              ? `about ${formatUnits(BigInt(leg.approximateSharesE18), 18, 4)} shares`
                              : "shares unavailable"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-fg2">
                          Deferred: {leg.reason}
                          {leg.amountUsdt !== "0"
                            ? ` ($${money(leg.amountUsdt)} stays in your wallet)`
                            : ""}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <dl className="mt-3">
                  <div className="detail-row">
                    <dt>Total of the buys</dt>
                    <dd data-testid="pies-total-usdt">${money(plan.totalUsdt)}</dd>
                  </div>
                  <div className="detail-row">
                    <dt>Unspent</dt>
                    <dd data-testid="pies-unspent">${money(plan.unspentUsdt)}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {vm.error && weightsOk ? (
              <p className="mt-3 text-red" role="alert">
                {vm.error}
              </p>
            ) : null}
            {flow.error ? (
              <p className="mt-3 text-red" role="alert">
                {flow.error}
              </p>
            ) : null}

            <div className="mt-6">
              {!wallet.authenticated ? (
                <Button onClick={wallet.login} data-testid="pies-signin">
                  Sign in to buy this basket
                </Button>
              ) : (
                <Button
                  disabled={!canStart}
                  onClick={() => setReviewing(true)}
                  data-testid="pies-start"
                >
                  Review and start
                </Button>
              )}
              {blocker ? (
                <p className="t-meta mt-2" data-testid="pies-blocker">
                  {blocker}
                </p>
              ) : null}
            </div>
          </section>
        </>
      )}

      <p className="t-meta flex items-center gap-2" data-testid="pies-roadmap">
        <Plus size={14} aria-hidden /> {vm.roadmap}
      </p>

      <Modal
        open={reviewing && plan !== null}
        onOpenChange={setReviewing}
        title="Review your basket"
        showClose
        className="max-w-[520px]"
      >
        {plan ? (
          <div data-testid="pies-review">
            <ul className="m-0 grid list-none gap-2 p-0">
              {executableLegs.map((leg) => (
                <li key={leg.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5">
                    <TokenIcon ticker={leg.ticker} size={24} />
                    <span className="font-semibold">{leg.symbol}</span>
                  </span>
                  <span className="num">${money(leg.amountUsdt)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-3">
              <div className="detail-row">
                <dt>Total</dt>
                <dd>${money(plan.totalUsdt)}</dd>
              </div>
              <div className="detail-row">
                <dt>Unspent</dt>
                <dd>${money(plan.unspentUsdt)}</dd>
              </div>
            </dl>
            <p className="mt-3 flex items-start gap-2 text-fg2">
              <ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
              Each stock is bought through the guarantee, one after another; you confirm each in
              your wallet.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  setReviewing(false);
                  void flow.start(plan);
                }}
                data-testid="pies-confirm"
              >
                Confirm and start
              </Button>
              <Button variant="glassy" onClick={() => setReviewing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
