import type { Hex } from "viem";
import type { PlanDto, ReceiptDto } from "@/lib/dto";
import type { TallyWallet } from "@/components/wallet/wallet-context";
import type { FlowParams } from "@/components/trade/use-trade-flow";
import {
  isTxHash,
  parsePendingPie,
  PENDING_PIE_KEY,
  validatePieRunInput,
  type PieBuyRun,
  type PieBuyRunLeg,
  type PieRunInput,
} from "./use-pie-run-state";
export type { PieBuyRun, PieBuyRunLeg, PieRunInput } from "./use-pie-run-state";

export interface PieRunTransport {
  wallet(): Pick<TallyWallet, "ready" | "authenticated" | "address" | "sendTx">;
  enabled(): boolean;
  tokenEnabled(ticker: string): boolean;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  plan(params: FlowParams, user: string): Promise<PlanDto>;
  receipt(hash: string, ticker: string, symbol: string): Promise<ReceiptDto>;
  txStatus(hash: string): Promise<{ status: "pending" | "success" | "reverted" }>;
  now(): number;
  sleep(): Promise<void>;
  id(): string;
  changed(): void;
  onWarn(message: string): void;
}

/** Sequential coordinator. Browser effects are injected for deterministic tests. */
export function createPieRunner(io: PieRunTransport, publish: (run: PieBuyRun | null) => void) {
  let current: PieBuyRun | null = null;
  let busy = false;
  let disposed = false;
  const isDone = (leg: PieBuyRunLeg) => leg.status === "done";
  const update = (run: PieBuyRun) => {
    if (disposed || io.wallet().address?.toLowerCase() !== run.wallet) return;
    run.updatedAt = io.now();
    io.storage.setItem(PENDING_PIE_KEY, JSON.stringify(run));
    if (!disposed && io.wallet().address?.toLowerCase() === run.wallet) {
      current = run;
      publish(JSON.parse(JSON.stringify(run)) as PieBuyRun);
    }
  };
  const saveSignedHash = (run: PieBuyRun, leg: PieBuyRunLeg) => {
    if (!disposed) {
      update(run);
      return;
    }
    if (io.wallet().address?.toLowerCase() !== run.wallet) return;
    const raw = io.storage.getItem(PENDING_PIE_KEY);
    const saved = raw ? parsePendingPie(raw, run.wallet, io.now()) : null;
    const entry = saved?.legs.find((item) => item.id === leg.id);
    // A wallet can resolve after unmount. Save only its newly known hash, never
    // overwrite another mounted coordinator's confirmed legs with an old run.
    if (!saved || saved.id !== run.id || !entry || entry.status === "done" || entry.pendingTx)
      return;
    Object.assign(entry, {
      pendingTx: leg.pendingTx,
      txHash: leg.txHash,
      approvalHash: leg.approvalHash,
      stage: leg.stage,
      stock: leg.stock,
      status: "pending",
      signatureUncertain: false,
      reason: null,
    });
    saved.status = "paused";
    saved.updatedAt = io.now();
    io.storage.setItem(PENDING_PIE_KEY, JSON.stringify(saved));
  };
  const assertWallet = (run: PieBuyRun) => {
    const wallet = io.wallet();
    if (
      disposed ||
      !wallet.ready ||
      !wallet.authenticated ||
      wallet.address?.toLowerCase() !== run.wallet
    )
      throw Object.assign(new Error("Basket stopped because the connected wallet changed"), {
        kind: "cancelled",
      });
    return wallet;
  };
  const fail = (run: PieBuyRun, leg: PieBuyRunLeg, error: unknown) => {
    const value = error as { code?: number; kind?: string };
    leg.status = "failed";
    leg.errorKind = value?.code === 4001 ? "rejected" : (value?.kind ?? "error");
    leg.reason =
      value?.code === 4001
        ? "You cancelled in your wallet. Nothing was spent on this leg."
        : error instanceof Error
          ? error.message
          : "This leg failed; nothing retries automatically";
    run.status = "failed";
    update(run);
  };
  const wait = async (run: PieBuyRun, leg: PieBuyRunLeg, resume: boolean) => {
    const pending = leg.pendingTx;
    if (!pending) return;
    const start = io.now();
    for (;;) {
      assertWallet(run);
      try {
        if (resume) {
          const status = await io.txStatus(pending.hash);
          if (status.status === "reverted")
            throw Object.assign(new Error("The saved transaction reverted"), { kind: "reverted" });
          if (status.status === "pending") {
            if (io.now() - start >= 180_000)
              throw Object.assign(new Error("Still waiting for confirmation; the hash is saved"), {
                kind: "timeout",
              });
            await io.sleep();
            continue;
          }
        }
        const receipt = await io.receipt(pending.hash, leg.ticker, leg.symbol);
        if (receipt.status === "reverted")
          throw Object.assign(new Error("The transaction reverted"), { kind: "reverted" });
        if (receipt.status === "success") {
          if (receipt.txHash.toLowerCase() !== pending.hash.toLowerCase())
            throw Object.assign(new Error("Receipt hash does not match the saved transaction"), {
              kind: "receipt_mismatch",
            });
          if (pending.kind === "buy") {
            if (
              receipt.fill &&
              (receipt.fill.user.toLowerCase() !== run.wallet ||
                (leg.stock && receipt.fill.stock.toLowerCase() !== leg.stock.toLowerCase()))
            )
              throw Object.assign(new Error("Receipt does not match this wallet and stock"), {
                kind: "receipt_mismatch",
              });
            leg.txHash = pending.hash;
            leg.status = "done";
            leg.reason = null;
            delete leg.errorKind;
            leg.receiptWarning = receipt.warning;
            io.changed();
          } else {
            leg.approvalHash = pending.hash;
            leg.status = "pending";
          }
          delete leg.pendingTx;
          delete leg.signatureUncertain;
          update(run);
          return;
        }
      } catch (error) {
        if ((error as { kind?: string }).kind) {
          if ((error as { kind?: string }).kind === "reverted") delete leg.pendingTx;
          throw error;
        }
        io.onWarn("Receipt source unavailable; retaining the saved hash and checking again");
      }
      if (io.now() - start >= 180_000)
        throw Object.assign(new Error("Still waiting for confirmation; the hash is saved"), {
          kind: "timeout",
        });
      await io.sleep();
    }
  };
  const execute = async (run: PieBuyRun) => {
    for (const leg of run.legs) {
      if (leg.status === "done") continue;
      try {
        assertWallet(run);
        if (leg.pendingTx) await wait(run, leg, true);
        if (isDone(leg)) continue;
        if (leg.signatureUncertain)
          throw new Error(
            "A signature was interrupted before its hash was saved. Check wallet activity before starting another run",
          );
        for (let signatures = 0; signatures < 2; signatures++) {
          assertWallet(run);
          if (!io.enabled()) throw new Error("Baskets are not enabled");
          if (!io.tokenEnabled(leg.ticker))
            throw new Error(`${leg.symbol} isn’t enabled in Tally yet`);
          leg.status = "pending";
          leg.stage = "planning";
          leg.reason = null;
          delete leg.errorKind;
          run.status = "running";
          update(run);
          const plan = await io.plan(
            {
              ticker: leg.ticker,
              issuer: "bstock",
              symbol: leg.symbol,
              usd: Number(BigInt(leg.amountUsdt) / 10n ** 16n) / 100,
              tolerancePct: 1,
            },
            run.wallet,
          );
          const wallet = assertWallet(run);
          if (!io.enabled()) throw new Error("Baskets are not enabled");
          if (!io.tokenEnabled(leg.ticker))
            throw new Error(`${leg.symbol} isn’t enabled in Tally yet`);
          if (
            plan.ticker !== leg.ticker ||
            plan.issuer !== "bstock" ||
            plan.symbol !== leg.symbol ||
            plan.amountInUsdt !== leg.amountUsdt
          )
            throw new Error("The fresh plan does not match this basket leg");
          if (plan.expiresAt <= io.now())
            throw new Error("The quote expired. Continue to request a fresh plan");
          if (plan.status === "needs_funds")
            throw Object.assign(new Error("Not enough USDT or BNB for this leg"), {
              kind: "needs_funds",
            });
          const approval = plan.status === "needs_approval";
          if (approval && signatures > 0)
            throw new Error(
              "Approval confirmed but still required; continue to recheck before another signature",
            );
          if (!approval && plan.status !== "ready")
            throw new Error("The plan is not ready to execute");
          if (approval && (!plan.approve || plan.approve.amount !== leg.amountUsdt))
            throw new Error("The approval does not match this leg’s exact amount");
          if (!approval && (!plan.tx || plan.tx.chainId !== 56 || BigInt(plan.tx.value) !== 0n))
            throw new Error("The buy plan has no valid BSC transaction");
          const tx = approval
            ? {
                to: plan.approve!.to as `0x${string}`,
                data: plan.approve!.data as Hex,
                gas: 80_000n,
                value: 0n,
              }
            : {
                to: plan.tx!.to as `0x${string}`,
                data: plan.tx!.data as Hex,
                gas: BigInt(plan.tx!.gasLimit),
                value: 0n,
              };
          leg.stock = plan.stock;
          leg.status = "signing";
          leg.stage = approval ? "approval" : "buy";
          leg.signatureUncertain = true;
          update(run); // Persist before opening the wallet, including the unknown-hash window.
          let hash: string;
          try {
            hash = await wallet.sendTx(tx);
          } catch (error) {
            if ((error as { code?: number }).code === 4001) delete leg.signatureUncertain;
            throw error;
          }
          if (!isTxHash(hash))
            throw new Error("Wallet returned no usable transaction hash; check wallet activity");
          leg.pendingTx = { kind: approval ? "approval" : "buy", hash };
          if (approval) leg.approvalHash = hash;
          else leg.txHash = hash;
          delete leg.signatureUncertain;
          leg.status = "pending";
          saveSignedHash(run, leg);
          await wait(run, leg, false);
          if (approval) continue; // Approval confirmed: obtain a fresh plan, never reuse the old quote.
          break;
        }
        if (!isDone(leg))
          throw new Error(
            "Approval is still required after replanning; nothing retries automatically",
          );
      } catch (error) {
        if ((error as { kind?: string }).kind === "cancelled") return;
        fail(run, leg, error);
        return;
      }
    }
    run.status = "done";
    update(run);
  };
  return {
    get run() {
      return current;
    },
    async start(input: PieRunInput) {
      if (busy) return;
      validatePieRunInput(input);
      if (!io.enabled()) throw new Error("Baskets are not enabled");
      const wallet = io.wallet();
      if (!wallet.ready || !wallet.authenticated || !wallet.address)
        throw new Error("Sign in before starting a basket");
      if (current?.legs.some((leg) => leg.pendingTx || leg.signatureUncertain))
        throw new Error("Resolve the saved transaction before starting another run");
      const legs: PieBuyRunLeg[] = input.legs
        .filter((leg) => leg.executable)
        .map((leg) => ({
          id: leg.id,
          sequence: leg.sequence,
          ticker: leg.ticker,
          issuer: leg.issuer,
          symbol: leg.symbol,
          amountUsdt: leg.amountUsdt,
          executable: true,
          reason: null,
          status: "not_started",
        }));
      if (!legs.length) throw new Error("There are no executable basket legs");
      const run: PieBuyRun = {
        schema: 1,
        id: io.id(),
        wallet: wallet.address.toLowerCase(),
        templateId: input.templateId,
        budgetUsdt: input.budgetUsdt,
        createdAt: io.now(),
        updatedAt: io.now(),
        status: "running",
        legs,
      };
      busy = true;
      try {
        update(run);
        await execute(run);
      } finally {
        busy = false;
      }
    },
    async continueRemaining() {
      if (busy || !current) return;
      busy = true;
      try {
        await execute(current);
      } finally {
        busy = false;
      }
    },
    async restore() {
      const wallet = io.wallet();
      if (!wallet.ready) return;
      if (current && (!wallet.authenticated || current.wallet !== wallet.address?.toLowerCase())) {
        io.storage.removeItem(PENDING_PIE_KEY);
        current = null;
        publish(null);
        return;
      }
      if (busy) return;
      const raw = io.storage.getItem(PENDING_PIE_KEY);
      if (!raw) {
        current = null;
        publish(null);
        return;
      }
      const run =
        wallet.authenticated && wallet.address
          ? parsePendingPie(raw, wallet.address, io.now())
          : null;
      if (!run) {
        io.onWarn("Saved basket is invalid, expired or belongs to another wallet; removing it");
        io.storage.removeItem(PENDING_PIE_KEY);
        current = null;
        publish(null);
        return;
      }
      current = run;
      publish(run);
      const leg = run.legs.find((entry) => entry.status !== "done");
      if (!leg) {
        run.status = "done";
        update(run);
        return;
      }
      busy = true;
      try {
        if (leg.status === "signing" && !leg.pendingTx) leg.signatureUncertain = true;
        if (leg.pendingTx) await wait(run, leg, true);
        run.status = run.legs.every((entry) => entry.status === "done")
          ? "done"
          : leg.status === "failed"
            ? "failed"
            : "paused";
        if (leg.signatureUncertain)
          fail(
            run,
            leg,
            new Error("Signature interrupted before its hash was saved; check wallet activity"),
          );
        else update(run);
      } catch (error) {
        if ((error as { kind?: string }).kind !== "cancelled") fail(run, leg, error);
      } finally {
        busy = false;
      }
    },
    clear() {
      if (busy || current?.legs.some((leg) => leg.pendingTx || leg.signatureUncertain)) return;
      io.storage.removeItem(PENDING_PIE_KEY);
      current = null;
      publish(null);
    },
    dispose() {
      disposed = true;
    },
  };
}
