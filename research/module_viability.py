"""Read-only viability probes for the Switch and Sell modules (MODULES.md §6, gates V-B1/V-B2).

Run on the AWS Seoul EC2 (the Binance Web3 API refuses US callers). Nothing is signed or sent.

    cd ~/tally/spike && python3 ../research/module_viability.py --guard 0x28F6F19bffbF25E36452c78d12090F0bC922970a

For each pair it asks the Trading API for a quote and a swap transaction built for the
deployed ShareGuard (the address that would trade), then reports the route, execution mode,
error codes verbatim, and the share-true cost of the move:
  * V-B1 switch: NVDAB -> NVDAon, NVDAon -> NVDAB (and AAPL), i.e. stock -> stock in one route
  * V-B2 sell:   each stock -> USDT
Run it once in US pre-market and once in regular hours (13:30-20:00 UTC); Ondo may behave
differently. Results: research/results/module_viability_<UTC>.json (no credentials inside).
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "spike"))
import w3api as w  # noqa: E402  (spike helper: signed client, RPC, multipliers)

PAIRS_SWITCH = [("NVDAB", "NVDAon"), ("NVDAon", "NVDAB"), ("AAPLB", "AAPLon"), ("AAPLon", "AAPLB")]
SELLS = ["NVDAB", "NVDAon", "AAPLB", "AAPLon"]


def token_price(addr):
    p = (w.public_rwa(addr).get("tokenInfo") or {}).get("price")
    return float(p) if p else None


def probe(client, guard, from_sym, to_sym, usd):
    from_addr, from_src = w.TOKENS[from_sym] if from_sym in w.TOKENS else (w.USDT, None)
    to_addr, to_src = w.TOKENS[to_sym] if to_sym in w.TOKENS else (w.USDT, None)
    row = {"from": from_sym, "to": to_sym, "usdTarget": usd}
    price = token_price(from_addr)
    if not price:
        row["error"] = "no public price for source token"
        return row
    amount = int(usd / price * 1e18)  # all four stock tokens use 18 decimals
    row.update({"amountIn": str(amount), "sourceTokenPrice": price})
    try:
        q, routes = client.quote(to_addr, amount, guard, from_token=from_addr)
        row.update({"mode": q.get("executionMode"), "vendor": q.get("vendorName"), "routes": len(routes),
                    "route": w.route_text(q), "toTokenAmount": str(q.get("toTokenAmount")),
                    "priceImpactPercent": q.get("priceImpactPercent")})
        sw = client.swap(to_addr, amount, guard, q["quoteId"], "1", from_token=from_addr)
        tx = sw.get("tx") or {}
        row.update({"swapMode": sw.get("executionMode"), "router": tx.get("to"),
                    "calldataBytes": (len(tx.get("data") or "0x") - 2) // 2,
                    "minReceive": tx.get("minReceiveAmount"), "rfq": sw.get("rfq")})
    except w.ApiError as e:
        row["error"] = str(e)
        return row
    # share-true accounting for stock -> stock moves
    if from_src and to_src:
        m_in, _ = w.multiplier(from_addr, from_src)
        m_out, _ = w.multiplier(to_addr, to_src)
        shares_in = amount * m_in / 1e36
        shares_out = int(row["toTokenAmount"]) * m_out / 1e36
        row.update({"sharesIn": shares_in, "sharesOut": shares_out,
                    "shareCostPct": (1 - shares_out / shares_in) * 100 if shares_in else None})
    elif from_src:
        m_in, _ = w.multiplier(from_addr, from_src)
        shares_in = amount * m_in / 1e36
        usdt_out = int(row["toTokenAmount"]) / 1e18
        row.update({"sharesIn": shares_in, "usdtOut": usdt_out,
                    "usdtPerShare": usdt_out / shares_in if shares_in else None})
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--guard", required=True, help="deployed ShareGuard address (the trader the routes are built for)")
    ap.add_argument("--usd", type=float, default=7.0, help="size per probe (Ondo minimum is $5; keep >= 6)")
    a = ap.parse_args()
    client = w.Client()
    out = {"runAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "guard": a.guard, "switch": [], "sell": []}
    print(f"{'from':7s} {'to':7s} {'mode':6s} {'route':55s} result")
    for f, t in PAIRS_SWITCH:
        r = probe(client, a.guard, f, t, a.usd)
        out["switch"].append(r)
        res = r.get("error") or f"shares {r.get('sharesIn', 0):.6f} -> {r.get('sharesOut', 0):.6f} ({r.get('shareCostPct', 0):+.3f}% cost)"
        print(f"{f:7s} {t:7s} {str(r.get('swapMode') or r.get('mode') or '-'):6s} {str(r.get('route') or '-')[:55]:55s} {res}")
        time.sleep(0.5)
    for f in SELLS:
        r = probe(client, a.guard, f, "USDT", a.usd)
        out["sell"].append(r)
        res = r.get("error") or f"{r.get('usdtOut', 0):.4f} USDT = {r.get('usdtPerShare', 0):.2f}/share"
        print(f"{f:7s} {'USDT':7s} {str(r.get('swapMode') or r.get('mode') or '-'):6s} {str(r.get('route') or '-')[:55]:55s} {res}")
        time.sleep(0.5)
    d = os.path.join(os.path.dirname(__file__), "results")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"module_viability_{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2)
    print("saved", path)


if __name__ == "__main__":
    try:
        main()
    except w.ApiError as e:
        sys.exit(f"Trading API error (40304 = region block, 40102 = signature/clock): {e}")
