"""Print the tokenized-stock findings used in IDEAS.md from a snapshot folder.

    python3 research/analyze_snapshot.py research/snapshot-2026-09-30
"""
import json
import math
import os
import statistics as st
import sys

NAMES = ["ondo", "bstock", "xstocks"]


def load(d, f):
    p = os.path.join(d, f)
    return json.load(open(p)) if os.path.exists(p) else None


def main(d):
    lists = {n: {x["ticker"]: x for x in load(d, f"rwa_list_{n}.json")["data"] if x["chainId"] == "56"}
             for n in NAMES}
    allt = set().union(*lists.values())
    count = {t: sum(t in lists[n] for n in NAMES) for t in allt}
    print("## Universe (BSC)")
    for n in NAMES:
        ms = [float(x["multiplier"]) for x in lists[n].values() if x.get("multiplier")]
        print(f"  {n:8s} tokens={len(lists[n]):4d}  multiplier!=1: {sum(abs(m - 1) > 1e-9 for m in ms)}")
    print(f"  distinct tickers={len(allt)}  listed by all 3={sum(c == 3 for c in count.values())}"
          f"  by >=2={sum(c >= 2 for c in count.values())}")

    print("\n## Same ticker, different units (list API multipliers, top 6)")
    rows = []
    for t in allt:
        ms = {n: float(lists[n][t]["multiplier"]) for n in NAMES if t in lists[n]}
        if len(ms) >= 2:
            rows.append((max(ms.values()) / min(ms.values()) - 1, t, ms))
    for r in sorted(rows, reverse=True)[:6]:
        print(f"  {r[1]:6s} {', '.join(f'{k}={v:.4f}' for k, v in r[2].items())}")

    dyn = load(d, "rwa_dynamic_tri.json")
    tok = load(d, "token_dynamic_tri.json")
    onc = load(d, "onchain_multiplier_tri.json") or {}
    prem = {n: [] for n in NAMES}
    naive, mismatch, pairs = [], 0, 0
    three_way = []
    for t, v in dyn.items():
        ref = next((float(v[n]["data"]["stockInfo"]["price"]) for n in NAMES
                    if (v[n].get("data") or {}).get("stockInfo", {}).get("price")), None)
        tokp, shp = [], []
        for n in NAMES:
            ti = (v[n].get("data") or {}).get("tokenInfo") or {}
            if not ti.get("price") or not ti.get("sharesMultiplier"):
                continue
            p, m = float(ti["price"]), float(ti["sharesMultiplier"])
            lm = float(lists[n][t]["multiplier"])
            pairs += 1
            if abs(m - lm) > 1e-6:
                mismatch += 1
            oc = (onc.get(t) or {}).get(n)
            if isinstance(oc, float) and abs(oc - m) > 1e-6:
                three_way.append((t, n, lm, m, oc))
            if ref:
                prem[n].append((p / m / ref - 1) * 100)
                tokp.append(p)
                shp.append(p / m)
        if len(tokp) >= 2:
            naive.append((t, (max(tokp) / min(tokp) - 1) * 100, (max(shp) / min(shp) - 1) * 100))

    print("\n## Share-true premium vs US reference price (token price / multiplier / ref - 1)")
    for n in NAMES:
        v = prem[n]
        if v:
            print(f"  {n:8s} n={len(v):2d} median={st.median(v):+.3f}%  mean|prem|={st.mean(abs(x) for x in v):.3f}%"
                  f"  min={min(v):+.2f}%  max={max(v):+.2f}%")
    naive.sort(key=lambda x: -x[1])
    print("  largest naive token-price 'arbs':", ", ".join(f"{t} {a:.0f}%" for t, a, _ in naive[:5]))
    print(f"  list-vs-dynamic multiplier disagreements: {mismatch}/{pairs}")
    if three_way:
        print("  list vs dynamic vs on-chain disagreements (first 5):")
        for t, n, a, b, c in three_way[:5]:
            print(f"    {t:5s} {n:8s} list={a:.6f} dynamic={b:.6f} onchain={c:.6f}")

    print("\n## Where trading actually happens (24h on-chain buy+sell volume, triple-listed tickers)")
    for n in NAMES:
        vol = liq = 0.0
        for t, v in tok.items():
            dd = v[n].get("data") or {}
            vol += float(dd.get("volume24hBuy") or 0) + float(dd.get("volume24hSell") or 0)
            liq += float(dd.get("liquidity") or 0)
        print(f"  {n:8s} volume=${vol:,.0f}   reported liquidity=${liq:,.0f}")
    status = {n: sum(1 for v in dyn.values() if ((v[n].get('data') or {}).get('statusInfo') or {}).get('marketStatus'))
              for n in NAMES}
    print("  tokens returning a marketStatus:", status)

    div = load(d, "rwa_dynamic_ondo_dividend_set.json")
    if div:
        xs, ys = [], []
        for t, j in div.items():
            dd = j.get("data") or {}
            m = float(dd.get("tokenInfo", {}).get("sharesMultiplier") or 1)
            y = dd.get("stockInfo", {}).get("dividendYield")
            if y and m < 1.5:  # exclude split-adjusted tokens
                xs.append((m - 1) * 100)
                ys.append(float(y))
        mx, my = st.mean(xs), st.mean(ys)
        r = sum((a - mx) * (b - my) for a, b in zip(xs, ys)) / math.sqrt(
            sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in ys))
        print(f"\n## Ondo multiplier growth vs dividend yield: n={len(xs)} Pearson r={r:.3f}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "snapshot-2026-09-30"))
