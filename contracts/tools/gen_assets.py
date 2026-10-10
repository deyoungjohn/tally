"""Build the deploy inputs for ShareGuard from Binance's public RWA endpoints (no API key).

  python3 tools/gen_assets.py NVDA AAPL TSLA QQQ SPY

writes
  deploy/assets.json  stable: ticker -> bStock / Ondo token addresses (commit it)
  deploy/seeds.json   time-sensitive: the CURRENT Ondo shares multiplier per token, for the
                      owner-vouched first value of each Feed asset (do not commit; the deploy
                      script refuses seeds older than 2 hours)

Ondo has no onchain multiplier, so the seed comes from the RWA API. Two public endpoints carry
it (the list's `multiplier` and the dynamic endpoint's `sharesMultiplier`); the tool refuses to
write a seed when they differ by more than 0.1% (blueprint §7.3: sources must agree).
Standard library only. Runs anywhere the public bapi endpoints work (not region-gated).
"""
import json
import os
import re
import sys
import time
import urllib.request

BAPI = "https://www.binance.com/bapi/defi"
UA = {"Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)"}
HERE = os.path.dirname(os.path.abspath(__file__))
DEPLOY = os.path.join(HERE, "..", "deploy")
ROUTER = "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5"  # Trading API router = approve target (blueprint V7)
BSTOCK_PAUSE_MANAGER = "0x9fc74Be63f3589485B2423984a7a0557e0CF700a"  # traced from a bStock transfer (IDEAS F11)


def get(url, retries=3):
    err = None
    for i in range(retries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
        except Exception as e:  # noqa: BLE001 - public endpoints flake; retry then fail loudly
            err = e
            time.sleep(1 + i)
    sys.exit(f"request failed after {retries} tries: {url}: {err}")


def to_wei(s):
    whole, _, frac = str(s).partition(".")
    return int(whole) * 10**18 + int((frac + "0" * 18)[:18])


def main(tickers):
    if not tickers:
        sys.exit(__doc__)
    bad = [t for t in tickers if not re.fullmatch(r"[A-Z0-9.]{1,10}", t)]
    if bad:
        sys.exit(f"not tickers: {bad}. Pass only upper-case tickers (e.g. NVDA AAPL); if you pasted a command "
                 "with a trailing '# comment', your shell passed the comment as arguments. Nothing was written.")
    lists = {}
    for t, name in ((1, "ondo"), (3, "bstock")):
        j = get(f"{BAPI}/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai?type={t}")
        lists[name] = {x["ticker"]: x for x in j.get("data", []) if x["chainId"] == "56"}
    unknown = [tk for tk in tickers if tk not in lists["bstock"] and tk not in lists["ondo"]]
    if unknown:
        sys.exit(f"no bStock or Ondo token on BSC for: {unknown}. Nothing was written.")
    assets, seeds, problems = [], {}, []
    for tk in tickers:
        for kind in ("bstock", "ondo"):
            row = lists[kind].get(tk)
            if not row:
                print(f"  {tk}: no {kind} token on BSC, skipped")
                continue
            entry = {"symbol": row["symbol"], "ticker": tk, "address": row["contractAddress"], "kind": kind}
            assets.append(entry)
            if kind == "ondo":
                dyn = get(f"{BAPI}/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai"
                          f"?chainId=56&contractAddress={row['contractAddress']}").get("data") or {}
                m_dyn = (dyn.get("tokenInfo") or {}).get("sharesMultiplier")
                m_list = row.get("multiplier")
                if not m_dyn or not m_list:
                    problems.append(f"{row['symbol']}: multiplier missing (list={m_list}, dynamic={m_dyn})")
                    continue
                a, b = to_wei(m_dyn), to_wei(m_list)
                if abs(a - b) * 1000 > min(a, b):
                    problems.append(f"{row['symbol']}: sources disagree by >0.1% (list {m_list} vs dynamic {m_dyn});"
                                    " not seeded; do not deploy this asset until they agree")
                    continue
                seeds[row["symbol"]] = {"multiplier": str(a), "list": m_list, "dynamic": m_dyn}
            print(f"  {row['symbol']:8s} {kind:6s} {row['contractAddress']}")
    os.makedirs(DEPLOY, exist_ok=True)
    with open(os.path.join(DEPLOY, "assets.json"), "w") as f:
        json.dump({"router": ROUTER, "approveTarget": ROUTER, "bstockPauseManager": BSTOCK_PAUSE_MANAGER,
                   "count": len(assets), "assets": assets}, f, indent=2)
    now = int(time.time())
    with open(os.path.join(DEPLOY, "seeds.json"), "w") as f:
        json.dump({"fetchedAtUnix": now, "fetchedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                   "seeds": seeds}, f, indent=2)
    print(f"wrote deploy/assets.json ({len(assets)} tokens) and deploy/seeds.json ({len(seeds)} Ondo seeds)")
    if problems:
        print("\nPROBLEMS (these tokens have no seed; the deploy script will refuse them):")
        for p in problems:
            print("  -", p)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
