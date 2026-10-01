"use client";

import { usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, formatEther, http } from "viem";
import { bsc } from "viem/chains";
import { Button } from "@/components/motion/button";

const client = createPublicClient({
  chain: bsc,
  transport: http("https://bsc-dataseed.bnbchain.org"),
});

export function WalletCheck() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const [balance, setBalance] = useState<string>("…");
  const [hash, setHash] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const address = embedded?.address;

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const wei = await client.getBalance({ address: address as `0x${string}` });
      setBalance(`${formatEther(wei)} BNB`);
    } catch (e) {
      setBalance(`error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = async () => {
    if (!address) return;
    setStatus("Waiting for signature…");
    setHash(null);
    try {
      // 0-value self-transfer on BSC (chainId 56): the cheapest real transaction.
      const res = await sendTransaction({ to: address, value: 0, chainId: 56 }, { address });
      setHash(res.hash);
      setStatus("Sent");
      void refresh();
    } catch (e) {
      setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <main className="wrap section-pad relative z-10">
      <div className="glass mx-auto max-w-xl p-6">
        <h1 className="t-h3">Wallet check (M0 exit ③)</h1>
        <p className="mt-2 text-fg2">
          Sign in, let Privy create an embedded wallet, fund it with a few cents of BNB on BNB Smart
          Chain, then send a 0-value self-transfer.
        </p>
        <dl className="mt-5 grid gap-3 text-sm">
          <Row k="Privy ready" v={String(ready)} />
          <Row k="Signed in" v={String(authenticated)} />
          <Row k="Login" v={user?.email?.address ?? user?.id ?? "–"} />
          <Row k="Embedded wallet (BSC)" v={address ?? "–"} mono />
          <Row k="Wallet chain" v={embedded?.chainId ?? "–"} />
          <Row k="BNB balance" v={balance} />
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          {!authenticated ? (
            <Button disabled={!ready} onClick={() => login()}>
              Sign in
            </Button>
          ) : (
            <>
              <Button disabled={!address} onClick={send}>
                Send 0 BNB to self
              </Button>
              <Button variant="glassy" onClick={() => void refresh()}>
                Refresh balance
              </Button>
              <Button variant="ghost" onClick={() => logout()}>
                Sign out
              </Button>
            </>
          )}
        </div>
        {status ? (
          <p className="mt-4 text-sm text-fg2" role="status">
            {status}
          </p>
        ) : null}
        {hash ? (
          <a
            className="mono mt-2 block break-all text-sm text-blue"
            href={`https://bscscan.com/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
          >
            {hash}
          </a>
        ) : null}
      </div>
    </main>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/[0.06] pb-2">
      <dt className="text-fg2">{k}</dt>
      <dd className={`text-right break-all ${mono ? "mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}
