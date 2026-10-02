"use client";

import {
  type ConnectedWallet,
  usePrivy,
  useSendTransaction,
  useWallets,
} from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatEther, http } from "viem";
import { bsc } from "viem/chains";
import { Button } from "@/components/motion/button";

const client = createPublicClient({
  chain: bsc,
  transport: http("https://bsc-dataseed.bnbchain.org"),
});

const isBsc = (w: ConnectedWallet) => w.chainId === "eip155:56" || w.chainId === "56";
const label = (w: ConnectedWallet) =>
  w.walletClientType === "privy"
    ? "Embedded (Privy)"
    : `External: ${w.walletClientType} via ${w.connectorType}`;

/**
 * M0 checks (blueprint §8.1): 1) embedded wallet on BSC sends a real tx, 2) an external wallet
 * (Binance Web3 Wallet) connects and signs on BSC. Both send a 0-value self-transfer.
 */
export function WalletCheck() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const [selected, setSelected] = useState<string | null>(null);
  const [balance, setBalance] = useState<string>("…");
  const [hash, setHash] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");

  // Prefer the wallet the user picked, then the embedded one, then the first connected one.
  const wallet =
    wallets.find((w) => w.address === selected) ??
    wallets.find((w) => w.walletClientType === "privy") ??
    wallets[0];
  const address = wallet?.address;
  const onBsc = wallet ? isBsc(wallet) : false;

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

  const switchToBsc = async () => {
    if (!wallet) return;
    setStatus("Asking the wallet to switch to BNB Smart Chain…");
    try {
      await wallet.switchChain(56);
      setStatus("Switched to chain 56");
    } catch (e) {
      setStatus(`Switch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const send = async () => {
    if (!wallet || !address) return;
    setStatus("Waiting for signature…");
    setHash(null);
    try {
      let txHash: string;
      if (wallet.walletClientType === "privy") {
        // 0-value self-transfer on BSC (chainId 56): the cheapest real transaction.
        txHash = (await sendTransaction({ to: address, value: 0, chainId: 56 }, { address })).hash;
      } else {
        const provider = await wallet.getEthereumProvider();
        const wc = createWalletClient({
          account: address as `0x${string}`,
          chain: bsc,
          transport: custom(provider),
        });
        txHash = await wc.sendTransaction({ to: address as `0x${string}`, value: 0n });
      }
      setHash(txHash);
      setStatus("Sent");
      void refresh();
    } catch (e) {
      setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <main className="wrap section-pad relative z-10">
      <div className="glass mx-auto max-w-xl p-6">
        <h1 className="t-h3">Wallet check (M0)</h1>
        <p className="mt-2 text-fg2">
          Sign in with email (embedded wallet) or connect an external wallet. Fund the wallet with a
          few cents of BNB on BNB Smart Chain, make sure it is on chain 56, then send a 0-value
          self-transfer.
        </p>
        <dl className="mt-5 grid gap-3 text-sm">
          <Row k="Privy ready" v={String(ready)} />
          <Row k="Signed in" v={String(authenticated)} />
          <Row k="Login" v={user?.email?.address ?? user?.id ?? "–"} />
          <Row k="Wallets connected" v={String(wallets.length)} />
          <Row k="Active wallet" v={wallet ? label(wallet) : "–"} />
          <Row k="Address" v={address ?? "–"} mono />
          <Row k="Wallet chain" v={wallet?.chainId ?? "–"} />
          <Row k="BNB balance" v={balance} />
        </dl>

        {wallets.length > 1 ? (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Choose wallet">
            {wallets.map((w) => (
              <Button
                key={w.address}
                variant={w.address === address ? "primary" : "glassy"}
                onClick={() => setSelected(w.address)}
              >
                {label(w)}
              </Button>
            ))}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {!authenticated ? (
            <Button disabled={!ready} onClick={() => login()}>
              Sign in
            </Button>
          ) : (
            <>
              {wallet && !onBsc ? <Button onClick={switchToBsc}>Switch to BSC</Button> : null}
              <Button disabled={!wallet || !onBsc} onClick={send}>
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
        {authenticated && wallets.length === 0 ? (
          <p className="mt-4 text-sm text-amber" role="status">
            Signed in, but no wallet is connected yet. If you connected an external wallet, wait a
            moment or reconnect it. Check the browser console for Privy errors.
          </p>
        ) : null}
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
