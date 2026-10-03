"""Module viability probes (Flow, Guardian, X-ray/Statement, Pies, Rewards). Read-only: sends no transaction.

Run from a non-blocked IP (your PC in Nigeria or the Seoul EC2), from the repo root:

    Windows:  py spike\\record_module_probes.py
    WSL/EC2:  python3 spike/record_module_probes.py

Reads BINANCE_W3_API_KEY / BINANCE_W3_API_SECRET (and optional BSC_RPC) from the environment or the repo-root
.env file; never prints or writes them. Every response, including errors, is saved because error text tells us
the right parameter names. Output: spike/results/module_probes_<stamp>.json (send it back / push it).

What it answers:
  F  Flow tape:   do trades / top-trader / holder / price-info / candles work for bStock and Ondo tokens?
                  can we fall back to raw Transfer logs over BSC RPC, and how many blocks per eth_getLogs call?
  G  Guardian:    what statusInfo do bStock tokens carry (the 10-02 list had none)? underlying-market for bStock;
                  does the Upcoming Earnings tab (tabId=3) work?
  X  Statement:   portfolio overview / recent-pnl / token latest-pnl / dex-history for the burner wallet.
  P  Pies:        sector tabs 9 (Mag 7) and 13 (Buffett) membership; rwa/price batch with the correct parameter.
  R  Rewards:     DeFi protocol / investment list on BSC (Venus etc.).
  L  Leaderboard: leaderboard/list and address-tracker/trades parameter discovery.
"""
import datetime as dt
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)


def read_dotenv(path):
    """KEY=VALUE parser that copes with a UTF-8 BOM or a UTF-16 file (Windows Notepad). Values are never printed."""
    if not os.path.exists(path):
        print(f".env not found at {path}")
        return {}
    raw = open(path, "rb").read()
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        text, enc = raw.decode("utf-16"), "utf-16"
    else:
        text, enc = raw.decode("utf-8-sig", errors="replace"), "utf-8"
    out = {}
    for line in text.splitlines():
        line = line.strip().lstrip("\ufeff")
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        out[k] = v.strip().strip('"').strip("'")
    print(f".env: {path} ({enc}), names: {sorted(out)}")
    return out


def load_dotenv(path):
    """Values from the repo .env override anything set in Windows environment variables."""
    for k, v in read_dotenv(path).items():
        os.environ[k] = v


load_dotenv(os.path.join(ROOT, ".env"))
import w3api  # noqa: E402  (imported after .env so BSC_RPC is picked up)


def rpc_url(name, value):
    """Accept either a full URL or a bare provider key; never print the value."""
    if not value:
        return None
    if value.startswith("http"):
        return value
    return {"BSC_RPC_NODEREAL": f"https://bsc-mainnet.nodereal.io/v1/{value}",
            "BSC_RPC_ANKR": f"https://rpc.ankr.com/bsc/{value}"}[name]


# Only these two are used. BSC_RPC / BSC_RPC_URL (QuickNode, possibly still set in Windows env vars) are ignored.
PRIVATE_RPCS = [(n, rpc_url(n, os.environ.get(n))) for n in ("BSC_RPC_NODEREAL", "BSC_RPC_ANKR")]
missing = [n for n, u in PRIVATE_RPCS if not u]
if missing:
    print(f"WARNING: {missing} not set in .env; on-chain log tests will skip them")
PRIVATE_RPCS = [(n, u) for n, u in PRIVATE_RPCS if u]
print("RPC providers used:", [n for n, _ in PRIVATE_RPCS] or "none")
# private providers first, then the public ones w3api already knows
w3api.RPCS[:] = [u for _, u in PRIVATE_RPCS] + ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"]

CHAIN = "56"
TOKENS = {
    "NVDAB": "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    "NVDAon": "0xa9ee28c80f960b889dfbd1902055218cba016f75",
    "AAPLB": "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a",
    "AAPLon": "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4",
}
WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930"  # spike burner (public address, holds the F6 positions)
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
res = {"_meta": {"startedAt": dt.datetime.now(dt.timezone.utc).isoformat()}}
client = None


def call(name, method, path, params=None, body=None):
    time.sleep(0.4)  # the API answers 42900 above ~5 calls/s
    t0 = time.time()
    try:
        data = client.get(path, params or {}) if method == "GET" else client.post(path, body)
        res[name] = {"method": method, "path": path, "params": params, "body": body, "ok": True, "data": data}
    except w3api.ApiError as e:
        res[name] = {"method": method, "path": path, "params": params, "body": body, "ok": False, **e.res}
    except Exception as e:  # noqa: BLE001
        res[name] = {"method": method, "path": path, "params": params, "body": body, "ok": False, "exception": repr(e)}
    r = res[name]
    r["ms"] = round((time.time() - t0) * 1000)
    d = r.get("data")
    if r["ok"]:
        summary = f"{len(d)} items" if isinstance(d, list) else str(d)[:80]
    else:
        summary = str(r.get("body") or r.get("exception"))[:120]
    print(f"{'ok ' if r['ok'] else 'ERR'} {name} ({r['ms']} ms): {summary}")


def per_token(prefix, method, path, extra=None, key="tokenContractAddress"):
    for sym, addr in TOKENS.items():
        params = {"binanceChainId": CHAIN, key: addr, **(extra or {})}
        if method == "GET":
            call(f"{prefix}_{sym}", "GET", path, params)
        else:
            call(f"{prefix}_{sym}", "POST", path, body=params)


def rpc_one(url, method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, headers={"content-type": "application/json", "User-Agent": "curl/8"})
    r = json.load(urllib.request.urlopen(req, timeout=30))
    if "error" in r:
        raise RuntimeError(str(r["error"])[:200])
    return r["result"]


def flow_from_logs():
    """Fallback flow source: raw ERC-20 Transfer logs. For each provider, find the largest block window it accepts."""
    out = {"providers": {}}
    for name, url in PRIVATE_RPCS + [("public_dataseed", "https://bsc-dataseed.bnbchain.org")]:
        p = {}
        try:
            head = int(rpc_one(url, "eth_blockNumber", []), 16)
            p["head"] = head
            for window in (10000, 5000, 2000, 1000, 500, 100, 50, 20, 10, 5):
                try:
                    t0 = time.time()
                    logs = rpc_one(url, "eth_getLogs", [{"address": TOKENS["NVDAB"], "topics": [TRANSFER],
                                                         "fromBlock": hex(head - window), "toBlock": hex(head)}])
                    p.update(maxWindowOk=window, ms=round((time.time() - t0) * 1000), transfers=len(logs))
                    b0 = rpc_one(url, "eth_getBlockByNumber", [hex(head - window), False])
                    b1 = rpc_one(url, "eth_getBlockByNumber", [hex(head), False])
                    p["windowMinutes"] = round((int(b1["timestamp"], 16) - int(b0["timestamp"], 16)) / 60, 1)
                    p["sample"] = logs[:2]
                    break
                except Exception as e:  # noqa: BLE001
                    p.setdefault("windowErrors", {})[str(window)] = str(e)[:160]
                time.sleep(0.3)
        except Exception as e:  # noqa: BLE001
            p["exception"] = repr(e)[:200]
        out["providers"][name] = p
        print(f"logs {name}: max window {p.get('maxWindowOk')} blocks"
              f" (~{p.get('windowMinutes')} min, {p.get('transfers')} NVDAB transfers, {p.get('ms')} ms)"
              + ("" if p.get("maxWindowOk") else f" errors={list(p.get('windowErrors', {}).values())[:1] or p.get('exception')}"))
    res["F_logs"] = out


def main():
    global client
    if "--logs-only" in sys.argv:
        flow_from_logs()
        return save()
    client = w3api.Client()
    M = "/api/v1/dex/market"

    # F. Flow tape (Market API). Parameter names from the general-data docs page.
    per_token("F_trades", "GET", f"{M}/trades", {"limit": 100})
    per_token("F_top_trader", "GET", f"{M}/token/top-trader")
    per_token("F_holder", "GET", f"{M}/token/holder")
    per_token("F_price_info", "POST", f"{M}/price-info")
    per_token("F_price", "POST", f"{M}/price")
    per_token("F_candles_1h", "GET", f"{M}/candles", {"bar": "1h", "limit": 300})
    per_token("F_candles_1d", "GET", f"{M}/candles", {"bar": "1d", "limit": 300})
    per_token("F_advanced_info", "GET", f"{M}/token/advanced-info")
    per_token("F_top_liquidity", "GET", f"{M}/token/top-liquidity")
    call("F_trades_buyer_filter", "GET", f"{M}/trades", {"binanceChainId": CHAIN, "tokenContractAddress": TOKENS["NVDAB"],
                                                      "limit": 50, "walletAddressFilter": WALLET})
    flow_from_logs()

    # L. Leaderboard / address tracker (parameter discovery: errors are useful)
    call("L_leaderboard", "GET", f"{M}/leaderboard/list", {"binanceChainId": CHAIN})
    call("L_address_tracker", "GET", f"{M}/address-tracker/trades", {"binanceChainId": CHAIN, "walletAddress": WALLET})
    for sort in (1, 4):
        call(f"L_leaderboard_7d_sort{sort}", "GET", f"{M}/leaderboard/list", {"binanceChainId": CHAIN, "timeFrame": 1, "sortBy": sort})
    call("L_address_tracker_kol", "GET", f"{M}/address-tracker/trades", {"binanceChainId": CHAIN, "trackerType": 2})
    call("L_address_tracker_t1", "GET", f"{M}/address-tracker/trades", {"binanceChainId": CHAIN, "walletAddress": WALLET, "trackerType": 1})
    call("L_address_tracker_b", "GET", f"{M}/address-tracker/trades", {"binanceChainId": CHAIN, "address": WALLET})

    # G. Guardian inputs
    call("G_rwa_tokens_bstock", "GET", f"{M}/rwa/tokens", {"binanceChainId": CHAIN, "platformId": "bstock"})
    call("G_rwa_tokens_earnings", "GET", f"{M}/rwa/tokens", {"binanceChainId": CHAIN, "tabId": 3})
    per_token("G_underlying_market", "GET", f"{M}/rwa/underlying-market")
    per_token("G_underlying_profile", "GET", f"{M}/rwa/underlying-profile")

    # P. Pies: sector tabs and batch price (correct parameter name this time)
    for tab, name in [(9, "mag7"), (13, "buffett"), (11, "etf"), (4, "ai_chips")]:
        call(f"P_tab_{name}", "GET", f"{M}/rwa/tokens", {"binanceChainId": CHAIN, "tabId": tab})
    call("P_rwa_price_batch", "GET", f"{M}/rwa/price", {"binanceChainId": CHAIN, "tokenContractAddresses": ",".join(TOKENS.values())})
    call("P_rwa_platforms", "GET", f"{M}/rwa/platforms", {})

    # X. Statement / portfolio for the burner wallet
    call("X_portfolio_overview", "GET", f"{M}/portfolio/overview", {"binanceChainId": CHAIN, "walletAddress": WALLET})
    call("X_portfolio_overview_b", "GET", f"{M}/portfolio/overview", {"binanceChainId": CHAIN, "address": WALLET})
    call("X_recent_pnl", "GET", f"{M}/portfolio/recent-pnl", {"binanceChainId": CHAIN, "walletAddress": WALLET})
    call("X_token_pnl", "GET", f"{M}/portfolio/token/latest-pnl", {"binanceChainId": CHAIN, "walletAddress": WALLET,
                                                                  "tokenContractAddress": TOKENS["NVDAB"]})
    call("X_dex_history", "GET", f"{M}/portfolio/dex-history", {"binanceChainId": CHAIN, "walletAddress": WALLET})
    call("X_tx_by_address", "GET", "/api/v1/dex/post-transaction/transactions-by-address",
         {"binanceChainId": CHAIN, "address": WALLET, "limit": 20})

    # R. Rewards / idle-cash yield (DeFi data)
    call("R_protocol_list", "POST", "/api/v1/defi/data/protocol/list", body={"binanceChainId": CHAIN})
    call("R_investment_list", "POST", "/api/v1/defi/data/investment/list", body={"binanceChainId": CHAIN})
    call("R_invest_earn", "POST", "/api/v1/defi/data/investment/list", body={"investType": "Earn", "binanceChainId": CHAIN, "page": 1, "size": 100})
    call("R_invest_earn_usdt", "POST", "/api/v1/defi/data/investment/list",
         body={"investType": "Earn", "binanceChainId": CHAIN, "tokenAddressList": [w3api.USDT], "page": 1, "size": 100})
    call("R_invest_lp", "POST", "/api/v1/defi/data/investment/list", body={"investType": "LiquidityPool", "binanceChainId": CHAIN, "page": 1, "size": 100})
    for sym in ("NVDAB", "NVDAon"):
        call(f"R_invest_lp_{sym}", "POST", "/api/v1/defi/data/investment/list",
             body={"investType": "LiquidityPool", "binanceChainId": CHAIN, "tokenAddressList": [TOKENS[sym]], "page": 1, "size": 100})
        call(f"R_invest_earn_{sym}", "POST", "/api/v1/defi/data/investment/list",
             body={"investType": "Earn", "binanceChainId": CHAIN, "tokenAddressList": [TOKENS[sym]], "page": 1, "size": 100})
    call("R_position_addresses", "POST", "/api/v1/defi/data/position/list", body={"addresses": [WALLET], "binanceChainIds": [CHAIN]})
    call("R_investment_list_b", "POST", "/api/v1/defi/data/investment/list", body={"binanceChainId": CHAIN, "page": 1, "size": 50})
    call("R_investment_list_venus", "POST", "/api/v1/defi/data/investment/list",
         body={"binanceChainId": CHAIN, "defiProtocolId": "venus", "page": 1, "size": 50})
    call("R_investment_list_tokens", "POST", "/api/v1/defi/data/investment/list",
         body={"binanceChainIds": [CHAIN], "page": 1, "size": 50})
    call("R_position_list_b", "POST", "/api/v1/defi/data/position/list", body={"walletAddress": WALLET, "binanceChainIds": [CHAIN]})
    call("X_portfolio_overview_tf", "GET", f"{M}/portfolio/overview", {"binanceChainId": CHAIN, "walletAddress": WALLET, "timeFrame": "1"})
    call("R_position_list", "POST", "/api/v1/defi/data/position/list", body={"binanceChainId": CHAIN, "walletAddress": WALLET})

    save()


def save():
    res["_meta"]["finishedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    out_dir = os.path.join(HERE, "results")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"module_probes_{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    ok = sum(1 for k, v in res.items() if isinstance(v, dict) and v.get("ok"))
    print(f"\n{ok} calls ok. Saved {os.path.relpath(path, ROOT)}")


if __name__ == "__main__":
    main()
