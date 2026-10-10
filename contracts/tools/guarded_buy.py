"""Buy a few dollars of a tokenized stock THROUGH ShareGuard v1 on BSC mainnet. REAL MONEY.

M2 exit check 3: two guarded buys (NVDAB and NVDAon, 6 USDT each) with `Guarded` events.
Run on the AWS Seoul EC2 (the authenticated Trading API refuses US callers, 40304).

    python3 tools/guarded_buy.py --guard 0xSHAREGUARD --token NVDAB --usdt 6                 # dry run
    python3 tools/guarded_buy.py --guard 0xSHAREGUARD --token NVDAB --usdt 6 --send          # real buy
    python3 tools/guarded_buy.py --guard 0xSHAREGUARD --token NVDAon --usdt 6 --send --sign-feed

What it does (blueprint §7.6): quote and swap calldata built for the GUARD's address; share
minimum = quoted shares x (1 - tolerance); exact-amount USDT approval to the guard; fresh
re-quote right before sending; gas = estimate x 1.25 (never the API's 450000), simulated at that
exact limit; then decodes the `Guarded` event from the receipt.

--sign-feed (Ondo only) signs a multiplier update with the FEED SIGNER key and sends
swapForSharesWithFeed, exercising the whole EIP-712 path. The key is read from FEED_SIGNER_PK or a
hidden prompt, used locally and never printed or saved. Without it, an Ondo buy uses the guard's
stored value (valid for maxAge, 3 days, after the owner-seeded deployment).

Private key of the BUYER: PARITY_PK env var or a hidden prompt; use a burner holding only
what the test needs (about 12 USDT + 0.002 BNB). Requires: pip install eth-account (spike/README.md).
Results go to contracts/results/ (push them).
"""
import argparse
import getpass
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "spike"))
import w3api as w  # noqa: E402  (shared signed client + RPC failover from the spike)

try:
    from eth_abi import encode
    from eth_account import Account
    from eth_account.messages import encode_typed_data
    from eth_utils import keccak, to_checksum_address
except ImportError:
    sys.exit("eth-account is missing: run `spike/.venv/bin/pip install eth-account` (see spike/README.md)")

MAX_USDT = 10.0  # a guard rail for a test script, not a product limit
ZERO = "0x" + "00" * 20
SOURCES = {1: "UiMultiplier", 2: "Multiplier", 3: "Feed"}
GUARDED_TOPIC = "0x" + keccak(b"Guarded(address,address,address,address,uint256,uint256,uint256,uint256,address)").hex()
SWAP_SIG = "swapForShares(address,uint256,address,uint256,address,bytes,address,uint256)"
SWAP_FEED_SIG = ("swapForSharesWithFeed(address,uint256,address,uint256,address,bytes,address,uint256,"
                 "(address,uint256,uint64,uint64),bytes)")


def selector(sig):
    return keccak(sig.encode())[:4]


def call(to, sig, types=(), args=(), out="uint256"):
    data = "0x" + (selector(sig) + (encode(list(types), list(args)) if types else b"")).hex()
    return w.rpc("eth_call", [{"to": to, "data": data}, "latest"])


def u(res, i=0):
    return int(res[2 + 64 * i: 2 + 64 * (i + 1)], 16)


def addr(res, i=0):
    return "0x" + res[2 + 64 * i + 24: 2 + 64 * (i + 1)]


def load_key(env, prompt):
    return os.environ.get(env) or getpass.getpass(prompt).strip()


def send(acct, to, data, value=0, gas=None):
    nonce = int(w.rpc("eth_getTransactionCount", [acct.address, "pending"]), 16)
    gas_price = int(w.rpc("eth_gasPrice", []), 16)
    tx = {"chainId": 56, "nonce": nonce, "to": to, "data": data, "value": value, "gas": int(gas), "gasPrice": gas_price}
    signed = Account.sign_transaction(tx, acct.key)
    raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
    tx_hash = w.rpc("eth_sendRawTransaction", ["0x" + bytes(raw).hex()])
    print(f"   sent {tx_hash} (gas limit {int(gas)})\n   https://bscscan.com/tx/{tx_hash}")
    return tx_hash, gas_price


def wait_receipt(tx_hash, seconds=180):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            receipt = w.rpc("eth_getTransactionReceipt", [tx_hash])
        except Exception as e:  # noqa: BLE001 - keep polling through RPC hiccups
            print("   (receipt poll error, retrying:", str(e)[:80], ")")
            receipt = None
        if receipt:
            print("   ", "confirmed" if receipt["status"] == "0x1" else "REVERTED", "in block",
                  int(receipt["blockNumber"], 16), "gas used", int(receipt["gasUsed"], 16))
            return receipt
        time.sleep(3)
    print("   no receipt yet; check the BscScan link above")
    return None


def read_guard(guard, stock):
    cfg = call(guard, "assetOf(address)", ["address"], [stock])
    info = {"owner": addr(call(guard, "owner()")), "feedSigner": addr(call(guard, "feedSigner()")),
            "paused": bool(u(call(guard, "paused()"))), "maxAge": u(call(guard, "maxAge()")),
            "source": SOURCES.get(u(cfg, 0), "None"), "enabled": bool(u(cfg, 1)), "maxStepBps": u(cfg, 2),
            "pauseCheck": u(cfg, 3), "pauseManager": addr(cfg, 4)}
    try:
        info["tokenPaused"] = bool(u(call(guard, "isTokenPaused(address)", ["address"], [stock])))
    except RuntimeError as e:
        info["tokenPaused"] = f"pause check reverts (fails closed): {e}"
    feed = call(guard, "feedOf(address)", ["address"], [stock])
    info["feed"] = {"multiplier": u(feed, 0), "updatedAt": u(feed, 1), "validAfter": u(feed, 2)}
    try:
        info["sharesPerToken"] = u(call(guard, "sharesPerToken(address)", ["address"], [stock]))
    except RuntimeError as e:
        info["sharesPerToken"] = None
        info["sharesPerTokenError"] = str(e)[:160]
    return info


def sign_feed_update(guard, stock, multiplier, signer_key):
    now = int(time.time())
    update = (stock, multiplier, now - 30, now + 900)
    typed = {
        "types": {
            "EIP712Domain": [{"name": "name", "type": "string"}, {"name": "version", "type": "string"},
                             {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}],
            "FeedUpdate": [{"name": "stock", "type": "address"}, {"name": "multiplier", "type": "uint256"},
                           {"name": "validAfter", "type": "uint64"}, {"name": "validUntil", "type": "uint64"}],
        },
        "primaryType": "FeedUpdate",
        "domain": {"name": "ShareGuard", "version": "1", "chainId": 56, "verifyingContract": guard},
        "message": {"stock": stock, "multiplier": multiplier, "validAfter": update[2], "validUntil": update[3]},
    }
    signed = Account.sign_typed_data(signer_key, full_message=typed) if hasattr(Account, "sign_typed_data") else \
        Account.sign_message(encode_typed_data(full_message=typed), signer_key)
    return update, bytes(signed.signature), Account.from_key(signer_key).address


def build_call(args, update, sig, amount, stock, min_shares, router, data, recipient, deadline):
    common = [w.USDT, amount, stock, min_shares, router, bytes.fromhex(data[2:]), recipient, deadline]
    types = ["address", "uint256", "address", "uint256", "address", "bytes", "address", "uint256"]
    if update:
        body = encode(types + ["(address,uint256,uint64,uint64)", "bytes"], common + [update, sig])
        return "0x" + (selector(SWAP_FEED_SIG) + body).hex()
    return "0x" + (selector(SWAP_SIG) + encode(types, common)).hex()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--guard", required=True, help="deployed ShareGuard address")
    p.add_argument("--token", required=True, choices=sorted(w.TOKENS))
    p.add_argument("--usdt", type=float, default=6.0)
    p.add_argument("--tolerance", type=float, default=1.0, help="percent below the quoted shares you accept (default 1)")
    p.add_argument("--sign-feed", action="store_true", help="Ondo: sign a multiplier update (needs FEED_SIGNER_PK)")
    p.add_argument("--send", action="store_true", help="actually sign and broadcast (real funds)")
    a = p.parse_args()
    if not 0 < a.usdt <= MAX_USDT:
        sys.exit(f"--usdt must be between 0 and {MAX_USDT} for this test script")
    if a.usdt < 6:
        print("note: the minimum order is 6 USDT (Ondo's $5 minimum is checked in USD, and 5 USDT is worth less)")
    guard = to_checksum_address(a.guard)
    token_addr, source = w.TOKENS[a.token]
    amount = int(round(a.usdt * 10**18))
    acct = Account.from_key(load_key("PARITY_PK", "Burner wallet private key (hidden): "))
    client = w.Client()
    wallet = acct.address
    result = {"token": a.token, "tokenAddress": token_addr, "guard": guard, "wallet": wallet, "usdtIn": str(amount),
              "startedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "mode": "send" if a.send else "dry-run", "signedFeed": a.sign_feed}

    usdt_bal = w.erc20_balance(w.USDT, wallet)
    bnb_bal = int(w.rpc("eth_getBalance", [wallet, "latest"]), 16)
    stock_before = w.erc20_balance(token_addr, wallet)
    print(f"wallet {wallet}\n  USDT {usdt_bal / 1e18:.4f}  BNB {bnb_bal / 1e18:.6f}  {a.token} {stock_before / 1e18:.8f}")
    if usdt_bal < amount:
        sys.exit(f"not enough USDT: need {a.usdt}")
    if bnb_bal < 5 * 10**14:
        sys.exit("need at least ~0.0005 BNB for gas (approve + guarded swap)")

    info = read_guard(guard, token_addr)
    result["guardState"] = info
    print(f"guard {guard}: owner {info['owner']}, paused={info['paused']}, asset {info['source']} "
          f"enabled={info['enabled']}, token paused: {info['tokenPaused']}")
    if info["paused"] or not info["enabled"] or info["tokenPaused"] is not False:
        return finish(result, "guard paused, asset disabled, or token paused: nothing sent")
    if (info["source"] == "Feed") != (source == "feed"):
        return finish(result, f"guard config source {info['source']} does not match this token's issuer")

    update = sig = None
    mult = info["sharesPerToken"]
    if source == "feed" and a.sign_feed:
        api_mult, mult_from = w.multiplier(token_addr, source)
        stored = info["feed"]["multiplier"]
        step_bps = (api_mult - stored) * 10_000 // stored if stored else 0
        print(f"  feed: API multiplier {api_mult / 1e18:.9f} ({mult_from}); guard holds {stored / 1e18:.9f} "
              f"({step_bps:+d} bps, bound {info['maxStepBps']})")
        if api_mult < stored or step_bps > info["maxStepBps"]:
            return finish(result, "the update is outside the onchain bound: that needs an owner-registered "
                                  "CorporateAction, so nothing was signed or sent")
        update, sig, signer = sign_feed_update(guard, token_addr, api_mult,
                                               load_key("FEED_SIGNER_PK", "Feed signer private key (hidden): "))
        if signer.lower() != info["feedSigner"].lower():
            return finish(result, f"FEED_SIGNER_PK is for {signer}, but the guard's feed signer is {info['feedSigner']}")
        mult = api_mult
        result["feedUpdate"] = {"multiplier": str(api_mult), "validAfter": update[2], "validUntil": update[3],
                                "signer": signer}
    elif mult is None:
        return finish(result, f"the guard has no usable multiplier ({info.get('sharesPerTokenError')}). For an Ondo "
                              "token whose feed is stale, rerun with --sign-feed")
    ref = w.public_rwa(token_addr).get("stockInfo", {}).get("price")
    print(f"  multiplier used {mult / 1e18:.9f}; US reference price {ref}")
    result.update({"multiplier": str(mult), "referencePrice": ref})

    def quote_and_swap():
        q, routes = client.quote(token_addr, amount, guard)  # built for the GUARD's address, not the wallet
        sw = client.swap(token_addr, amount, guard, q["quoteId"], f"{a.tolerance:g}")
        return q, routes, sw

    q, routes, sw = quote_and_swap()
    tx = sw.get("tx") or {}
    print(f"  quote: {q.get('vendorName')} {sw.get('executionMode')} -> {int(q['toTokenAmount']) / 1e18:.8f} {a.token}"
          f"\n  route: {w.route_text(q)}")
    if sw.get("executionMode") != "SWAP" or not tx.get("to"):
        return finish(result, "RFQ mode needs a signed order (not supported); try the other issuer")
    if not u(call(guard, "allowedRouter(address)", ["address"], [tx["to"]])):
        return finish(result, f"the API's router {tx['to']} is not on the guard's allow list: nothing sent")
    spender = addr(call(guard, "approveTargetOf(address)", ["address"], [tx["to"]]))
    if (q.get("approveTarget") or tx["to"]).lower() != spender.lower():
        return finish(result, "the API's approve target differs from the guard's configured approve target")

    def min_shares_for(quote):
        quoted_shares = int(quote["toTokenAmount"]) * mult // 10**18
        return quoted_shares * int(round((100 - a.tolerance) * 100)) // 10_000, quoted_shares

    min_shares, quoted_shares = min_shares_for(q)
    print(f"  you'll get at least {min_shares / 1e18:.8f} shares ({quoted_shares / 1e18:.8f} quoted, "
          f"{a.tolerance:g}% tolerance) or nothing happens")
    result["quote"] = {"vendor": q.get("vendorName"), "route": w.route_text(q), "routes": len(routes),
                       "toTokenAmount": q.get("toTokenAmount"), "quotedShares": str(quoted_shares),
                       "minShares": str(min_shares), "router": tx["to"], "apiGas": tx.get("gas")}
    allowance = w.erc20_allowance(w.USDT, wallet, guard)

    if not a.send:
        print("\nDRY RUN only (nothing signed). Re-run with --send to buy."
              + ("" if allowance >= amount else f"\nIt will first approve exactly {a.usdt} USDT to the guard."))
        return finish(result)

    expect = f"BUY {a.token}"
    if input(f"\nThis spends {a.usdt} real USDT from {wallet} through ShareGuard {guard}. "
             f"Type '{expect}' to continue: ").strip() != expect:
        return finish(result, "not confirmed")

    if allowance < amount:
        print(f"1/2 approve exactly {a.usdt} USDT to the guard")
        h, _ = send(acct, w.USDT, "0x" + (selector("approve(address,uint256)") + encode(["address", "uint256"], [guard, amount])).hex(),
                    gas=80_000)
        result["approveTx"] = h
        r = wait_receipt(h)
        if not r or r["status"] != "0x1":
            return finish(result, "approve not confirmed" if not r else "approve reverted")

    # Fresh quote right before sending (V11): the earlier one may have gone stale while you typed.
    q, routes, sw = quote_and_swap()
    tx = sw.get("tx") or {}
    if sw.get("executionMode") != "SWAP" or not tx.get("to"):
        return finish(result, "route switched to RFQ before sending")
    min_shares, quoted_shares = min_shares_for(q)
    deadline = int(time.time()) + 300
    cd = build_call(a, update, sig, amount, token_addr, min_shares, tx["to"], tx["data"], wallet, deadline)
    call_obj = {"from": wallet, "to": guard, "data": cd}
    try:
        estimate = int(w.rpc("eth_estimateGas", [call_obj]), 16)  # raises if the guarded swap would revert
        limit = math.ceil(estimate * 1.25)
        w.rpc("eth_call", [{**call_obj, "gas": hex(limit)}, "latest"])  # simulate at the exact limit we send
    except RuntimeError as e:
        return finish(result, f"guarded swap would revert, nothing sent: {e}")
    api_gas = int(str(tx.get("gas") or "0"), 0)
    print(f"2/2 guarded swap via {w.route_text(q)}\n   min {min_shares / 1e18:.8f} shares; gas: estimate {estimate:,}, "
          f"API {api_gas:,}" + ("  <-- API value too low" if estimate > api_gas else "") + f", sending {limit:,}")
    result.update({"gasEstimate": estimate, "gasLimitSent": limit, "apiGas": api_gas, "minShares": str(min_shares),
                   "routeAtSend": w.route_text(q), "toTokenAmountAtSend": q.get("toTokenAmount")})

    h, gas_price = send(acct, guard, cd, gas=limit)
    result["swapTx"] = h
    result["bscscan"] = f"https://bscscan.com/tx/{h}"
    r = wait_receipt(h)
    if not r:
        return finish(result, "no receipt yet; check BscScan")
    result["swapStatus"] = "success" if r["status"] == "0x1" else "reverted"
    result["gasUsed"] = int(r["gasUsed"], 16)
    result["gasBNB"] = int(r["gasUsed"], 16) * gas_price / 1e18
    event = next((lg for lg in r.get("logs", []) if lg["address"].lower() == guard.lower()
                  and lg["topics"] and lg["topics"][0] == GUARDED_TOPIC), None)
    if r["status"] == "0x1" and event:
        d = event["data"]
        tokens_out, shares, mult_used = u(d, 2), u(d, 3), u(d, 4)
        got = w.erc20_balance(token_addr, wallet) - stock_before
        result["guarded"] = {"user": addr(event["topics"][1], 0), "recipient": addr(event["topics"][2], 0),
                             "stock": addr(event["topics"][3], 0), "amountIn": str(u(d, 1)), "tokensOut": str(tokens_out),
                             "shares": str(shares), "multiplier": str(mult_used), "router": addr(d, 5),
                             "walletBalanceDelta": str(got)}
        per_share = amount / shares if shares else None
        result["usdtPerShare"] = per_share
        if per_share and ref:
            result["premiumVsReferencePct"] = (per_share / float(ref) - 1) * 100
        print(f"\nGuarded: {tokens_out / 1e18:.8f} {a.token} = {shares / 1e18:.8f} shares (>= {min_shares / 1e18:.8f}) "
              f"at {per_share:.4f} USDT/share" + (f" ({result['premiumVsReferencePct']:+.3f}% vs reference {ref})" if ref else ""))
        if got != tokens_out:
            print("WARNING: wallet balance change differs from the event's tokensOut")
    elif r["status"] == "0x1":
        result["warning"] = "swap succeeded but no Guarded event from this guard was found in the receipt"
    return finish(result)


def finish(result, aborted=None):
    if aborted:
        result["aborted"] = aborted
        print("stopped:", aborted)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results")
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, f"guarded_{result['token']}_{result['mode']}_{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}.json")
    with open(path, "w") as f:
        json.dump(result, f, indent=2)
    print("saved", os.path.normpath(path))


if __name__ == "__main__":
    try:
        main()
    except w.ApiError as e:
        sys.exit(f"Trading API error (40304 = region block, 40102 = signature/clock): {e}")
