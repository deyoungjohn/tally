"""Fetch a fresh snapshot of the BSC tokenized-stock universe.

Uses only public, key-less endpoints (the same ones the binance-skills-hub
skills call) plus a public BSC RPC, so anyone can reproduce the numbers in
IDEAS.md. Writes JSON files into research/snapshot-<UTC date>/.

    python3 research/fetch_snapshot.py
"""
import concurrent.futures as cf
import json
import os
import sys
import time
import urllib.request

UA = {"Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)"}
BAPI = "https://www.binance.com/bapi/defi"
WEB3 = "https://web3.binance.com/bapi/defi"
RPC = os.environ.get("BSC_RPC", "https://bsc-rpc.publicnode.com")
PROVIDERS = {1: "ondo", 2: "xstocks", 3: "bstock"}
DIVIDEND_SET = ["KO", "PEP", "PG", "PFE", "CVX", "XOM", "JNJ", "T", "VZ", "MO", "ABBV",
                "MRK", "SPY", "QQQ", "AAPL", "MSFT", "JPM", "HD", "O", "NVDA", "TSLA",
                "AMZN", "META", "GOOGL", "UNH", "IBM", "CSCO", "BAC", "WMT", "MCD"]
# 4-byte selectors (keccak256 of the signature)
SEL = {"bstock": "0xa60bf13d",   # uiMultiplier()
       "xstocks": "0x1b3ed722"}  # multiplier()


def get(url, retries=3):
    req = urllib.request.Request(url, headers=UA)
    for i in range(retries):
        try:
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception as e:  # noqa: BLE001 - public endpoints flake; retry then record
            err = str(e)
            time.sleep(1 + i)
    return {"error": err}


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json",
                                                          "User-Agent": "curl/8"})
    return json.load(urllib.request.urlopen(req, timeout=30)).get("result")


def main():
    out = os.path.join(os.path.dirname(__file__), "snapshot-" + time.strftime("%Y-%m-%d", time.gmtime()))
    os.makedirs(out, exist_ok=True)
    meta = {"fetched_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rpc": RPC}

    lists = {}
    for t, name in PROVIDERS.items():
        j = get(f"{BAPI}/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai?type={t}")
        json.dump(j, open(os.path.join(out, f"rwa_list_{name}.json"), "w"))
        lists[name] = {x["ticker"]: x for x in j.get("data", []) if x["chainId"] == "56"}

    tri = sorted(t for t in lists["ondo"] if t in lists["xstocks"] and t in lists["bstock"])
    jobs = [(n, t) for t in tri for n in PROVIDERS.values()]

    def rwa_dyn(nt):
        n, t = nt
        a = lists[n][t]["contractAddress"]
        return nt, get(f"{BAPI}/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=56&contractAddress={a}")

    def tok_dyn(nt):
        n, t = nt
        a = lists[n][t]["contractAddress"]
        return nt, get(f"{WEB3}/v4/public/wallet-direct/buw/wallet/market/token/dynamic/info/ai?chainId=56&contractAddress={a}")

    def onchain(nt):
        n, t = nt
        if n not in SEL:
            return nt, None
        a = lists[n][t]["contractAddress"]
        try:
            r = rpc("eth_call", [{"to": a, "data": SEL[n]}, "latest"])
            return nt, (int(r, 16) / 1e18 if r and r != "0x" else None)
        except Exception as e:  # noqa: BLE001
            return nt, {"error": str(e)}

    with cf.ThreadPoolExecutor(8) as ex:
        for fn, fname in [(rwa_dyn, "rwa_dynamic_tri.json"), (tok_dyn, "token_dynamic_tri.json"),
                          (onchain, "onchain_multiplier_tri.json")]:
            res = {}
            for (n, t), j in ex.map(fn, jobs):
                res.setdefault(t, {})[n] = j
            json.dump(res, open(os.path.join(out, fname), "w"))

        div = [t for t in DIVIDEND_SET if t in lists["ondo"]]
        res = {}
        for (n, t), j in ex.map(rwa_dyn, [("ondo", t) for t in div]):
            res[t] = j
        json.dump(res, open(os.path.join(out, "rwa_dynamic_ondo_dividend_set.json"), "w"))

    json.dump(meta, open(os.path.join(out, "meta.json"), "w"), indent=2)
    print("wrote", out, meta)


if __name__ == "__main__":
    sys.exit(main())
