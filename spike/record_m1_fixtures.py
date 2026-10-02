"""Record raw Binance Web3 API responses as M1 test fixtures. RUN THIS ON THE AWS SEOUL EC2 (the API refuses US callers).

    cd ~/tally && git pull && python3 spike/record_m1_fixtures.py

Credentials: BINANCE_W3_API_KEY / BINANCE_W3_API_SECRET from the environment, or a hidden prompt.
Output: packages/binance/fixtures/raw/*.json (raw API bodies; the key and secret are never written).
Nothing here sends a transaction or needs a funded wallet. The guard address is only a quote placeholder.
Every call is recorded even when it fails: failures (including HTTP-200 error codes) are the point.
"""
import json
import os
import sys
import time
import datetime as dt
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import w3api  # noqa: E402  (spike client; keeps the old "parity" identifiers on purpose)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "binance", "fixtures", "raw")
os.makedirs(OUT, exist_ok=True)
SNAP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "research", "snapshot-2026-09-30")
WALLET = w3api.GUARD_ADDR
USDT = w3api.USDT
BNB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
STAMP = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def save(name, payload):
    path = os.path.join(OUT, f"{name}_{STAMP}.json")
    with open(path, "w") as f:
        json.dump(payload, f, indent=1)
    print("saved", os.path.relpath(path))


def raw_call(client, path, params):
    """Like Client.get but returns the raw {http, body} even for error codes."""
    try:
        data = client.get(path, params)
        return {"path": path, "params": params, "http": 200, "ok": True, "data": data}
    except w3api.ApiError as e:
        return {"path": path, "params": params, "ok": False, **e.res}
    except Exception as e:  # network trouble: record it, keep going
        return {"path": path, "params": params, "ok": False, "exception": repr(e)}


def tokens_for(ticker):
    """{issuer: (symbol, address)} on BSC from the M0 snapshot lists."""
    found = {}
    for issuer, fname in (("ondo", "rwa_list_ondo.json"), ("bstock", "rwa_list_bstock.json"), ("xstocks", "rwa_list_xstocks.json")):
        rows = json.load(open(os.path.join(SNAP, fname)))["data"]
        for r in rows:
            if r.get("chainId") == "56" and r.get("ticker") == ticker:
                found[issuer] = (r["symbol"], r["contractAddress"])
    return found


def main():
    client = w3api.Client()
    t0 = time.time()

    # 0. Health / auth. From a blocked IP this is where 40304 shows up.
    save("health_supported_chain", raw_call(client, "/api/v1/dex/aggregator/supported/chain", {"binanceChainId": "56"}))

    # 1. Quote ladder: executable issuers for NVDA, AAPL, NFLX at several sizes, wallet = guard placeholder.
    quotes = []
    for ticker in ("NVDA", "AAPL", "NFLX"):
        for issuer, (symbol, addr) in tokens_for(ticker).items():
            if issuer == "xstocks":
                continue  # never executable (blueprint V3); data only
            for usdt in (6, 25, 100, 1000):
                res = raw_call(client, "/api/v1/dex/aggregator/quote", {
                    "binanceChainId": "56", "amount": str(usdt * 10**18), "fromTokenAddress": USDT,
                    "toTokenAddress": addr, "userWalletAddress": WALLET})
                quotes.append({"ticker": ticker, "issuer": issuer, "symbol": symbol, "usdt": usdt,
                               "at": dt.datetime.now(dt.timezone.utc).isoformat(), "response": res})
                time.sleep(0.4)  # rate limits unknown: stay gentle
    save("quote_ladder", quotes)

    # 2. Error cases we must handle: Ondo below $5 (40375), Ondo with no wallet (40001), bad key (40101/40102).
    ondo = tokens_for("NVDA")["ondo"][1]
    errors = {
        "ondo_5_usdt_40375": raw_call(client, "/api/v1/dex/aggregator/quote", {
            "binanceChainId": "56", "amount": str(5 * 10**18), "fromTokenAddress": USDT,
            "toTokenAddress": ondo, "userWalletAddress": WALLET}),
        "ondo_no_wallet_40001": raw_call(client, "/api/v1/dex/aggregator/quote", {
            "binanceChainId": "56", "amount": str(6 * 10**18), "fromTokenAddress": USDT, "toTokenAddress": ondo}),
    }
    bad = w3api.Client(key="invalid-key-for-fixture", secret="invalid-secret")
    errors["bad_credentials"] = raw_call(bad, "/api/v1/dex/aggregator/supported/chain", {"binanceChainId": "56"})
    save("error_cases", errors)

    # 3. One swap build per issuer at 25 USDT (calldata shape, gas fields, MEV-related fields if any).
    swaps = {}
    for issuer, (symbol, addr) in tokens_for("NVDA").items():
        if issuer == "xstocks":
            continue
        q = raw_call(client, "/api/v1/dex/aggregator/quote", {
            "binanceChainId": "56", "amount": str(25 * 10**18), "fromTokenAddress": USDT,
            "toTokenAddress": addr, "userWalletAddress": WALLET})
        qid = ((q.get("data") or [{}])[0]).get("quoteId")
        swaps[symbol] = {"quote": q, "swap": raw_call(client, "/api/v1/dex/aggregator/swap", {
            "binanceChainId": "56", "amount": str(25 * 10**18), "fromTokenAddress": USDT, "toTokenAddress": addr,
            "userWalletAddress": WALLET, "quoteId": qid, "slippagePercent": "1"}) if qid else None}
    save("swap_build", swaps)

    # 4. BNB price for fee display (blueprint 7.4 step 7): a tiny quote returns BNB tokenUnitPrice.
    save("quote_bnb_price", raw_call(client, "/api/v1/dex/aggregator/quote", {
        "binanceChainId": "56", "amount": str(6 * 10**18), "fromTokenAddress": USDT,
        "toTokenAddress": BNB, "userWalletAddress": WALLET}))

    # 5. Authenticated RWA Data API. Parameter names are guesses from the blueprint: the point is to capture
    #    the real error/hint text when a guess is wrong, so every probe is saved whatever it returns.
    nvda = tokens_for("NVDA")
    probes = {}
    for name, path, params in [
        ("rwa_tokens", "/api/v1/dex/market/rwa/tokens", {"chainId": "56"}),
        ("rwa_price", "/api/v1/dex/market/rwa/price", {"binanceChainId": "56", "tokenContractAddress": nvda["ondo"][1]}),
        ("rwa_search", "/api/v1/dex/market/rwa/search", {"keyword": "NVDA"}),
        ("rwa_underlying_profile", "/api/v1/dex/market/rwa/underlying-profile", {"binanceChainId": "56", "tokenContractAddress": nvda["ondo"][1]}),
        ("rwa_underlying_market", "/api/v1/dex/market/rwa/underlying-market", {"binanceChainId": "56", "tokenContractAddress": nvda["ondo"][1]}),
        ("rwa_platforms", "/api/v1/dex/market/rwa/platforms", {}),
    ]:
        probes[name] = raw_call(client, path, params)
        time.sleep(0.4)
    save("rwa_authenticated_probes", probes)

    # 6. Rate-limit probe: 30 sequential supported/chain calls. Records the first non-success and the pace.
    burst, first_fail = [], None
    for i in range(30):
        r = raw_call(client, "/api/v1/dex/aggregator/supported/chain", {"binanceChainId": "56"})
        burst.append({"i": i, "t": round(time.time() - t0, 2), "ok": r.get("ok"), "http": r.get("http"),
                      "code": (r.get("body") or {}).get("code") if isinstance(r.get("body"), dict) else None})
        if not r.get("ok") and first_fail is None:
            first_fail = {"i": i, **r}
    save("rate_limit_probe", {"calls": burst, "first_failure": first_fail})
    print("done in", round(time.time() - t0), "s")


if __name__ == "__main__":
    main()
