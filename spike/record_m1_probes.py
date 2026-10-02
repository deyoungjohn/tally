"""Second M1 recording, RUN ON THE AWS SEOUL EC2: probes the endpoints the first run couldn't pin down.

    cd ~/tally && git pull && python3 spike/record_m1_probes.py

What it answers:
  1. How to page /market/rwa/tokens (the first run returned 488 of ~545 BSC tokens, no xStocks).
  2. Correct parameters for rwa price / underlying-profile / underlying-market (first run guessed wrong).
  3. Do the Market, Transaction (gas-price, block-height, gas-limit, simulate) and Wallet (balances) paths from
     web3.binance.com/en/dev-docs/llms-full.txt work, and what do their responses look like?
Parameter names for 3 come from a summary of the docs, so some guesses may be wrong: every response, including
errors, is saved because the error text tells us the right names. Nothing here sends a transaction.
Reads BINANCE_W3_API_KEY / BINANCE_W3_API_SECRET from the environment or a hidden prompt; never writes them.
Output: packages/binance/fixtures/raw/probes_<stamp>.json (commit and push it).
"""
import datetime as dt
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import w3api  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "binance", "fixtures", "raw")
NVDAON = "0xa9ee28c80f960b889dfbd1902055218cba016f75"
NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436"
WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930"  # the spike burner: public address, holds the F6 positions
GUARD = w3api.GUARD_ADDR
USDT = w3api.USDT
CHAIN = "56"
res = {}
client = None


def call(name, method, path, params=None, body=None):
    time.sleep(0.4)  # the API answers 42900 above ~5 calls/s
    try:
        data = client.get(path, params or {}) if method == "GET" else client.post(path, body)
        res[name] = {"method": method, "path": path, "params": params, "body": body, "ok": True, "data": data}
    except w3api.ApiError as e:
        res[name] = {"method": method, "path": path, "params": params, "body": body, "ok": False, **e.res}
    except Exception as e:  # noqa: BLE001
        res[name] = {"method": method, "path": path, "params": params, "body": body, "ok": False, "exception": repr(e)}
    r = res[name]
    summary = f"{len(r['data'])} items" if r.get("ok") and isinstance(r.get("data"), list) else (str(r.get("data"))[:70] if r.get("ok") else str(r.get("body") or r.get("exception"))[:110])
    print(f"{'ok ' if r['ok'] else 'ERR'} {name}: {summary}")


def main():
    global client
    client = w3api.Client()
    T = "/api/v1/dex/market/rwa/tokens"

    # 1. Paging the RWA token list. Compare count and first symbol against the plain call.
    call("rwa_tokens_plain", "GET", T, {"chainId": CHAIN})
    for name, extra in [("pageSize1000", {"pageSize": 1000}), ("limit1000", {"limit": 1000}), ("page2", {"page": 2}), ("pageNo2", {"pageNo": 2}),
                        ("pageIndex2", {"pageIndex": 2}), ("offset488", {"offset": 488}), ("tabId", {"tabId": "1"}), ("platformId_xstocks", {"platformId": "xstocks"}),
                        ("platformId_bstock", {"platformId": "bstock"})]:
        call(f"rwa_tokens_{name}", "GET", T, {"chainId": CHAIN, **extra})

    # 2. RWA detail endpoints with the parameter names the first run's errors asked for.
    ids = {"binanceChainId": CHAIN, "tokenContractAddress": NVDAON}
    call("rwa_price", "GET", "/api/v1/dex/market/rwa/price", ids)
    call("rwa_underlying_profile", "GET", "/api/v1/dex/market/rwa/underlying-profile", ids)
    call("rwa_underlying_market", "GET", "/api/v1/dex/market/rwa/underlying-market", ids)
    call("rwa_underlying_profile_bstock", "GET", "/api/v1/dex/market/rwa/underlying-profile", {"binanceChainId": CHAIN, "tokenContractAddress": NVDAB})

    # 3. Market
    call("market_price", "GET", "/api/v1/dex/market/price", {"binanceChainId": CHAIN, "tokenContractAddress": NVDAB})
    call("market_candlestick", "GET", "/api/v1/dex/market/candlestick", {"binanceChainId": CHAIN, "tokenContractAddress": NVDAB, "bar": "1H", "limit": 24})

    # 3. Transaction (read-only)
    call("tx_supported_chain", "GET", "/api/v1/dex/pre-transaction/supported/chain")
    call("tx_gas_price", "GET", "/api/v1/dex/pre-transaction/gas-price", {"binanceChainId": CHAIN})
    call("tx_block_height", "GET", "/api/v1/dex/pre-transaction/block-height", {"binanceChainId": CHAIN})
    # A harmless read: USDT.balanceOf(burner), as gas-limit and simulate input. Body field names are guesses.
    bal = "0x70a08231" + w3api.word(WALLET)
    evm = {"from": GUARD, "to": USDT, "data": bal, "value": "0"}
    call("tx_gas_limit", "POST", "/api/v1/dex/pre-transaction/gas-limit", body={"binanceChainId": CHAIN, "address": GUARD, "to": USDT, "data": bal, "value": "0"})
    call("tx_simulate_a", "POST", "/api/v1/dex/pre-transaction/simulate", body={"binanceChainId": CHAIN, "evmTx": evm})
    call("tx_simulate_b", "POST", "/api/v1/dex/pre-transaction/simulate", body={"binanceChainId": CHAIN, "from": GUARD, "to": USDT, "data": bal, "value": "0"})

    # 3. Wallet: the burner holds 3 USDT, 0.025957 NVDAB and 0.026093 NVDAon after F6 (public on-chain data).
    call("bal_supported_chain", "GET", "/api/v1/dex/balance/supported/chain")
    call("bal_all", "GET", "/api/v1/dex/balance/all-token-balances-by-address", {"chainId": CHAIN, "address": WALLET, "pageSize": 100})
    call("bal_all_binanceChainId", "GET", "/api/v1/dex/balance/all-token-balances-by-address", {"binanceChainId": CHAIN, "address": WALLET, "pageSize": 100})
    call("bal_specific", "POST", "/api/v1/dex/balance/token-balances-by-address", body={"address": WALLET, "tokenContractAddresses": [{"binanceChainId": CHAIN, "tokenContractAddress": NVDAB}, {"binanceChainId": CHAIN, "tokenContractAddress": NVDAON}]})
    call("history_tx", "GET", "/api/v1/dex/post-transaction/transactions-by-address", {"chainId": CHAIN, "address": WALLET, "limit": 5})
    # The F6 successful NVDAB swap, for the aggregator history endpoint:
    call("agg_history", "GET", "/api/v1/dex/aggregator/history", {"binanceChainId": CHAIN, "txHash": "0x726aace915e720ca46f4cfb344a7283c4aa1ef59bde225fdea9796e2f0eb0ba7"})

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"probes_{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json")
    with open(path, "w") as f:
        json.dump(res, f, indent=1)
    print("saved", os.path.relpath(path))


if __name__ == "__main__":
    main()
