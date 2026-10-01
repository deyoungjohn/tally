"""Capture real Trading API swap calldata for the ShareGuard fork test. Read-only.

For one token it asks the Trading API for a USDT -> stock quote and swap transaction twice:
  * eoa:   built for TEST_USER (a test key the fork test controls), used to replay the
           route as a plain wallet and inside an EIP-7702 batch
  * guard: built for GUARD_ADDR, where the fork test deploys ShareGuard, to see whether
           the route still works when a contract is the trader
Nothing is signed or sent. The output JSON is read by forge (vm.parseJson*), so every
integer is written as a decimal string and every byte string as 0x-hex.

    python3 capture_route.py --token NVDAB --usdt 6
"""
import argparse
import json
import os
import time

import w3api as w


def leg(client, token_addr, amount, wallet, slippage):
    q, routes = client.quote(token_addr, amount, wallet)
    out = {"user": wallet, "mode": q.get("executionMode"), "vendor": q.get("vendorName"),
           "routeCount": str(len(routes)), "route": w.route_text(q), "quoteId": q.get("quoteId"),
           "toTokenAmount": str(q.get("toTokenAmount")), "approveTarget": q.get("approveTarget") or "",
           "priceImpactPercent": str(q.get("priceImpactPercent")), "tradeFee": str(q.get("tradeFee"))}
    sw = client.swap(token_addr, amount, wallet, q["quoteId"], slippage)
    tx = sw.get("tx") or {}
    out.update({"swapMode": sw.get("executionMode"), "router": tx.get("to") or "",
                "data": tx.get("data") or "0x", "value": str(int(str(tx.get("value") or "0"), 0)),
                "gas": str(tx.get("gas") or ""), "minReceive": str(tx.get("minReceiveAmount") or "0"),
                "rfq": sw.get("rfq"), "signatureData": tx.get("signatureData")})
    if not out["approveTarget"]:
        out["approveTarget"] = out["router"]
    # The fork test only replays plain SWAP transactions; RFQ needs an EIP-712 order instead.
    out["replayable"] = "true" if out["swapMode"] == "SWAP" and out["router"] and out["data"] != "0x" else "false"
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--token", required=True, choices=sorted(w.TOKENS))
    p.add_argument("--usdt", type=float, default=6.0)  # Ondo minimum is 5 USD; 5 USDT < $5
    p.add_argument("--slippage", default="1")
    p.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "captures"))
    a = p.parse_args()

    token_addr, source = w.TOKENS[a.token]
    amount = int(a.usdt * 10**18)
    client = w.Client()
    mult, mult_from = w.multiplier(token_addr, source)
    ref = w.public_rwa(token_addr).get("stockInfo", {}).get("price")
    cap = {"token": a.token, "tokenAddress": token_addr, "tokenIn": w.USDT, "amountIn": str(amount),
           "multiplierSource": source, "multiplier": str(mult), "multiplierFrom": mult_from,
           "referencePrice": str(ref), "capturedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "blockAtCapture": str(int(w.rpc("eth_blockNumber", []), 16))}
    for name, wallet in [("eoa", w.TEST_USER), ("guard", w.GUARD_ADDR)]:
        try:
            cap[name] = leg(client, token_addr, amount, wallet, a.slippage)
        except w.ApiError as e:
            cap[name] = {"user": wallet, "replayable": "false", "error": str(e), "router": "", "data": "0x",
                         "approveTarget": "", "value": "0", "minReceive": "0", "toTokenAmount": "0", "mode": "ERROR"}
        c = cap[name]
        print(f"{a.token} {name:5s} mode={c.get('mode')}/{c.get('swapMode')} vendor={c.get('vendor')} "
              f"routes={c.get('routeCount')} replayable={c['replayable']} route: {c.get('route')}"
              + (f"\n      error: {c['error']}" if c.get("error") else ""))
    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, f"{a.token}.json")
    with open(path, "w") as f:
        json.dump(cap, f, indent=2)
    print("saved", path)


if __name__ == "__main__":
    try:
        main()
    except w.ApiError as e:
        raise SystemExit(f"Trading API error (40304 = region block, 40102 = signature/clock): {e}")
