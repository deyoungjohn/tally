"""Buy a few dollars of a tokenized stock on BSC mainnet through the Trading API. REAL MONEY.

Default is a DRY RUN: it checks balances, gets a quote, builds the swap and simulates it
with eth_call. Nothing is signed. Add --send to actually trade; you'll be asked to type a
confirmation first. Use a fresh burner wallet holding only what this test needs
(about 6 USDT + 0.001 BNB for gas per buy), never your main wallet.

    python3 live_buy.py --token NVDAB --usdt 6            # dry run
    python3 live_buy.py --token NVDAB --usdt 6 --send     # real buy

Private key: PARITY_PK env var or a hidden prompt. It is never printed or saved.
Results (tx hashes, amounts, shares received, effective price per share) are written to
spike/results/. Requires: pip install eth-account (see spike/README.md).
"""
import argparse
import getpass
import json
import os
import sys
import time

import w3api as w

MAX_USDT = 10.0  # a guard rail for a test script, not a product limit


def load_account():
    try:
        from eth_account import Account
    except ImportError:
        sys.exit("eth-account is missing: run `.venv/bin/pip install eth-account` (see spike/README.md)")
    key = os.environ.get("PARITY_PK") or getpass.getpass("Burner wallet private key (hidden): ").strip()
    return Account, Account.from_key(key)


def send(Account, acct, to, data, value=0, gas=None):
    """Sign and broadcast. Returns (tx_hash, gas_price); does not wait."""
    nonce = int(w.rpc("eth_getTransactionCount", [acct.address, "pending"]), 16)
    gas_price = int(w.rpc("eth_gasPrice", []), 16)
    if not gas:
        call = {"from": acct.address, "to": to, "data": data, "value": hex(value)}
        gas = int(int(w.rpc("eth_estimateGas", [call]), 16) * 1.3)
    tx = {"chainId": 56, "nonce": nonce, "to": to, "data": data, "value": value, "gas": int(gas), "gasPrice": gas_price}
    signed = Account.sign_transaction(tx, acct.key)
    raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
    tx_hash = w.rpc("eth_sendRawTransaction", ["0x" + bytes(raw).hex()])
    print(f"   sent {tx_hash} (gas limit {int(gas)})\n   https://bscscan.com/tx/{tx_hash}")
    return tx_hash, gas_price


def wait_receipt(tx_hash, seconds=180):
    """Polls for a receipt and tolerates flaky RPCs. Returns None on timeout, never raises."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            receipt = w.rpc("eth_getTransactionReceipt", [tx_hash])
        except Exception as e:  # noqa: BLE001 - keep polling through RPC hiccups
            print("   (receipt poll error, retrying:", str(e)[:80], ")")
            receipt = None
        if receipt:
            ok = receipt["status"] == "0x1"
            print("   ", "confirmed" if ok else "REVERTED", "in block", int(receipt["blockNumber"], 16),
                  "gas used", int(receipt["gasUsed"], 16))
            return receipt
        time.sleep(3)
    print("   no receipt yet; check the BscScan link above")
    return None


def swap_gas(wallet, tx):
    """The API returns gas=450000 for every route; a 4-hop route needed ~1.03M and reverted.
    Use max(API value, estimate x 1.25), and prove it with eth_call at that exact limit."""
    value = hex(int(str(tx.get("value") or "0"), 0))
    call = {"from": wallet, "to": tx["to"], "data": tx["data"], "value": value}
    estimate = int(w.rpc("eth_estimateGas", [call]), 16)  # raises if the swap would revert at any gas
    api_gas = int(str(tx.get("gas") or "0"), 0)
    limit = max(api_gas, int(estimate * 1.25))
    w.rpc("eth_call", [{**call, "gas": hex(limit)}, "latest"])
    return limit, estimate, api_gas


def build(client, token_addr, amount, wallet, slippage):
    q, routes = client.quote(token_addr, amount, wallet)
    sw = client.swap(token_addr, amount, wallet, q["quoteId"], slippage)
    return q, routes, sw


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--token", required=True, choices=sorted(w.TOKENS))
    p.add_argument("--usdt", type=float, default=6.0)
    p.add_argument("--slippage", default="1", help="percent, passed to the Trading API")
    p.add_argument("--send", action="store_true", help="actually sign and broadcast (real funds)")
    a = p.parse_args()
    if not 0 < a.usdt <= MAX_USDT:
        sys.exit(f"--usdt must be between 0 and {MAX_USDT} for this test script")
    if a.usdt < 5.5:
        print("note: Ondo quotes fail below 5 USD (40375), and 5 USDT is worth slightly under $5")

    token_addr, source = w.TOKENS[a.token]
    amount = int(round(a.usdt * 10**18))
    Account, acct = load_account()
    client = w.Client()
    wallet = acct.address
    result = {"token": a.token, "tokenAddress": token_addr, "wallet": wallet, "usdtIn": str(amount),
              "startedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "mode": "send" if a.send else "dry-run"}

    usdt_bal = w.erc20_balance(w.USDT, wallet)
    bnb_bal = int(w.rpc("eth_getBalance", [wallet, "latest"]), 16)
    stock_before = w.erc20_balance(token_addr, wallet)
    print(f"wallet {wallet}\n  USDT {usdt_bal / 1e18:.4f}  BNB {bnb_bal / 1e18:.6f}  {a.token} {stock_before / 1e18:.8f}")
    if usdt_bal < amount:
        sys.exit(f"not enough USDT: need {a.usdt}")
    if bnb_bal < 3 * 10**14:
        sys.exit("need at least ~0.0003 BNB for gas (approve + swap)")

    mult, mult_from = w.multiplier(token_addr, source)
    rwa = w.public_rwa(token_addr)
    ref = rwa.get("stockInfo", {}).get("price")
    status = (rwa.get("statusInfo") or {}).get("reasonCode")
    print(f"  multiplier {mult / 1e18:.6f} ({mult_from}); reference ${ref}; status {status}")
    result.update({"multiplier": str(mult), "multiplierFrom": mult_from, "referencePrice": ref, "statusAtStart": status})

    q, routes, sw = build(client, token_addr, amount, wallet, a.slippage)
    tx = sw.get("tx") or {}
    result["quote"] = {"vendor": q.get("vendorName"), "mode": q.get("executionMode"), "swapMode": sw.get("executionMode"),
                       "routes": len(routes), "route": w.route_text(q), "toTokenAmount": q.get("toTokenAmount"),
                       "tradeFee": q.get("tradeFee"), "priceImpactPercent": q.get("priceImpactPercent"),
                       "router": tx.get("to"), "approveTarget": q.get("approveTarget"),
                       "minReceive": tx.get("minReceiveAmount")}
    print(f"  quote: {q.get('vendorName')} {sw.get('executionMode')} -> {int(q['toTokenAmount']) / 1e18:.8f} {a.token}"
          f"\n  route: {w.route_text(q)}")
    if sw.get("executionMode") != "SWAP" or not tx.get("to"):
        result["aborted"] = "RFQ mode needs an EIP-712 order (order/submit); not handled by this spike"
        result["rfq"] = sw.get("rfq")
        return finish(result)

    spender = q.get("approveTarget") or tx["to"]
    allowance = w.erc20_allowance(w.USDT, wallet, spender)
    if allowance >= amount:
        try:
            limit, estimate, api_gas = swap_gas(wallet, tx)
            print(f"  simulation: OK. gas estimate {estimate:,} vs API gas {api_gas:,}"
                  + ("  <-- API value too low, would revert" if estimate > api_gas else ""))
            result["simulation"] = {"ok": True, "estimateGas": estimate, "apiGas": api_gas}
        except RuntimeError as e:
            print("  simulation: REVERT", e)
            result["simulation"] = f"revert: {e}"
    else:
        print(f"  simulation: skipped until USDT is approved for {spender} (allowance {allowance / 1e18})")
        result["simulation"] = "needs approval first"

    if not a.send:
        print("\nDRY RUN only. Re-run with --send to buy.")
        return finish(result)

    expect = f"BUY {a.token}"
    if input(f"\nThis spends {a.usdt} real USDT from {wallet}. Type '{expect}' to continue: ").strip() != expect:
        result["aborted"] = "not confirmed"
        return finish(result)

    if allowance < amount:
        print(f"1/2 approve exactly {a.usdt} USDT to {spender}")
        h, _ = send(Account, acct, w.USDT, w.SEL["approve"] + w.word(spender) + w.word(amount))
        result["approveTx"] = h
        r = wait_receipt(h)
        if not r or r["status"] != "0x1":
            result["aborted"] = "approve not confirmed" if not r else "approve reverted"
            return finish(result)

    # Fresh quote right before sending: the earlier one may have expired while you typed.
    q, routes, sw = build(client, token_addr, amount, wallet, a.slippage)
    tx = sw.get("tx") or {}
    result["quote"]["routeAtSend"] = w.route_text(q)
    result["quote"]["toTokenAmountAtSend"] = q.get("toTokenAmount")
    if sw.get("executionMode") != "SWAP" or not tx.get("to"):
        result["aborted"] = "route switched to RFQ before sending"
        return finish(result)
    try:
        limit, estimate, api_gas = swap_gas(wallet, tx)
    except RuntimeError as e:
        result["aborted"] = f"swap would revert, nothing sent: {e}"
        return finish(result)
    result.update({"gasLimitSent": limit, "estimateGas": estimate, "apiGas": api_gas})
    print(f"2/2 swap via {w.route_text(q)}\n   gas: estimate {estimate:,}, API {api_gas:,}, sending {limit:,}")

    h, gas_price = send(Account, acct, tx["to"], tx["data"], int(str(tx.get("value") or "0"), 0), limit)
    result["swapTx"] = h
    result["bscscan"] = f"https://bscscan.com/tx/{h}"
    r = wait_receipt(h)
    if not r:
        result["swapStatus"] = "unknown (no receipt yet)"
        return finish(result)
    result["swapStatus"] = "success" if r["status"] == "0x1" else "reverted"
    got = w.erc20_balance(token_addr, wallet) - stock_before
    shares = got * mult // 10**18
    gas_bnb = int(r["gasUsed"], 16) * gas_price / 1e18
    result.update({"tokensReceived": str(got), "sharesReceived": str(shares), "gasUsed": int(r["gasUsed"], 16),
                   "gasBNB": gas_bnb, "minReceive": tx.get("minReceiveAmount")})
    if shares:
        per_share = amount / shares
        result["usdtPerShare"] = per_share
        if ref:
            result["premiumVsReferencePct"] = (per_share / float(ref) - 1) * 100
        print(f"\nreceived {got / 1e18:.8f} {a.token} = {shares / 1e18:.8f} shares at {per_share:.4f} USDT/share"
              + (f" ({result['premiumVsReferencePct']:+.3f}% vs reference {ref})" if ref else ""))
    print(f"gas: {gas_bnb:.6f} BNB")
    return finish(result)


def finish(result):
    out = os.path.join(os.path.dirname(__file__), "results")
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, f"live_{result['token']}_{result['mode']}_{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}.json")
    with open(path, "w") as f:
        json.dump(result, f, indent=2)
    if result.get("aborted"):
        print("stopped:", result["aborted"])
    print("saved", path)


if __name__ == "__main__":
    try:
        main()
    except w.ApiError as e:
        sys.exit(f"Trading API error (40304 = region block, 40102 = signature/clock): {e}")
