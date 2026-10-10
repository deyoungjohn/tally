"use client";

import { useState } from "react";
import { formatUnits, parseDecimal } from "@tally/core";
import { usePieRun } from "@/components/pies/use-pie-run";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { buildPiesPageVM, type PiesPageVM } from "./basket-view-model";

/** Unstyled working contract for the UI agent and the flag-gated dev preview. */
export function PiesMiniContent({ initial }: { initial: PiesPageVM }) {
  const [budget, setBudget] = useState("30");
  const [threeOnly, setThreeOnly] = useState(false);
  const [percentages, setPercentages] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (initial.baskets[0]?.tokens ?? []).map((token) => [
        token.ticker,
        formatUnits(BigInt(token.weightBps), 2),
      ]),
    ),
  );
  const flow = usePieRun({ fixtures: initial.fixtures });
  const wallet = useTallyWallet();
  if (initial.empty)
    return (
      <section aria-label="Basket buying">
        <p>{initial.reason}</p>
      </section>
    );
  let vm = initial;
  try {
    const weightsBps = Object.fromEntries(
      Object.entries(percentages).map(([ticker, value]) => {
        if (!/^\d+(?:\.\d{0,2})?$/.test(value)) throw new Error("Invalid weight");
        return [ticker, Number(parseDecimal(value, 2))];
      }),
    );
    vm = buildPiesPageVM({
      budgetUsdt: parseDecimal(budget, 18),
      fixtures: initial.fixtures,
      weightsBps,
      meta: {
        stale: initial.stale,
        ageMs: initial.ageMs,
        source: initial.source,
        error: initial.error,
      },
      run: flow.run,
      wallet: wallet.address,
    });
  } catch {
    vm = {
      ...initial,
      state: "error",
      error: "Enter a valid budget and weights with at most two decimal places",
      plan: null,
    };
  }
  return (
    <section aria-label="Basket buying">
      {vm.label && <p>{vm.label}</p>}
      {vm.baskets.map((basket) => (
        <article key={basket.id}>
          <h2>{basket.name}</h2>
          <p>{basket.description}</p>
          <p>Minimum budget: {formatUnits(BigInt(basket.minimumBudgetUsdt), 18, 2)} USDT</p>
          <ul>
            {basket.tokens.map((token) => (
              <li key={token.symbol}>
                {token.symbol}: {token.weightBps / 100}%{!token.executable && ` · ${token.reason}`}
              </li>
            ))}
          </ul>
        </article>
      ))}
      <label>
        Budget USDT
        <input
          aria-label="Budget USDT"
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={threeOnly}
          onChange={(event) => {
            setThreeOnly(event.target.checked);
            setPercentages(
              event.target.checked
                ? { NVDA: "33.33", AAPL: "33.33", GOOGL: "33.34", MSFT: "0", META: "0" }
                : { NVDA: "20", AAPL: "20", GOOGL: "20", MSFT: "20", META: "20" },
            );
          }}
        />
        Three-token example
      </label>
      {initial.baskets[0]?.tokens.map((token) => (
        <label key={token.ticker}>
          Weight {token.symbol} %
          <input
            aria-label={`Weight ${token.symbol} %`}
            value={percentages[token.ticker] ?? "0"}
            onChange={(event) => {
              setThreeOnly(false);
              setPercentages({ ...percentages, [token.ticker]: event.target.value });
            }}
          />
        </label>
      ))}
      {vm.error && <p role="alert">{vm.error}</p>}
      {flow.error && <p role="alert">{flow.error}</p>}
      {vm.plan && (
        <>
          <ul>
            {vm.plan.legs.map((leg) => (
              <li key={leg.id}>
                {leg.symbol}: {formatUnits(BigInt(leg.amountUsdt), 18, 2)} USDT
                {!leg.executable && ` · Deferred: ${leg.reason}`}
              </li>
            ))}
          </ul>
          <p>
            Buys: {formatUnits(BigInt(vm.plan.totalUsdt), 18, 2)} USDT · Unspent:{" "}
            {formatUnits(BigInt(vm.plan.unspentUsdt), 18, 2)} USDT
          </p>
          {!wallet.authenticated ? (
            <button onClick={wallet.login}>Sign in</button>
          ) : (
            <button
              disabled={
                !flow.ready ||
                !vm.plan.legs.some((leg) => leg.executable) ||
                flow.run?.status === "running"
              }
              onClick={() => {
                if (vm.plan) void flow.start(vm.plan);
              }}
            >
              Start basket
            </button>
          )}
        </>
      )}
      <p>
        Each stock is bought through the guarantee, one after another; you confirm each in your
        wallet.
      </p>
      {flow.run && (
        <section aria-label="Basket progress">
          <p data-testid="pie-status">{flow.run.status}</p>
          <ol>
            {flow.run.legs.map((leg) => (
              <li key={leg.id} data-testid={`pie-leg-${leg.ticker}`}>
                {leg.symbol}: {leg.status}
                {leg.stage && ` · ${leg.stage}`}
                {leg.reason && ` · ${leg.reason}`}
                {leg.txHash && <a href={`https://bscscan.com/tx/${leg.txHash}`}>Receipt</a>}
              </li>
            ))}
          </ol>
          {flow.canContinue && (
            <button onClick={() => void flow.continueRemaining()}>
              Continue with the remaining legs
            </button>
          )}
        </section>
      )}
      <p>{vm.roadmap}</p>
    </section>
  );
}
