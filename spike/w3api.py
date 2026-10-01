"""Tiny shared client for the Parity spike scripts (standard library only).

* Binance Web3 API: HMAC-signed requests (X-OC-* headers, /build prefix in URL and signature)
* BSC JSON-RPC
* public, key-less RWA endpoints used for multipliers and the US reference price

Credentials come from BINANCE_W3_API_KEY / BINANCE_W3_API_SECRET or a hidden prompt.
"""
import base64
import datetime as dt
import getpass
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://web3.binance.com"
PREFIX = "/build"
CHAIN = "56"
USDT = "0x55d398326f99059fF775485246999027B3197955"  # BSC USDT (18 decimals)

# Fixed addresses the fork test also hard-codes (spike/shareguard/test/ShareGuardFork.t.sol)
TEST_USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7"  # vm.addr(0xA11CE)
GUARD_ADDR = "0xcb634955B8A7DF7B106f7AB47C9759B26206b777"  # last 20 bytes of keccak("parity.shareguard.fork")

# BSC NVDA/AAPL per issuer, from research/snapshot-2026-09-30. multiplier source:
#   ui = token.uiMultiplier() (bStock), multiplier = token.multiplier() (xStocks), feed = off-chain (Ondo)
TOKENS = {
    "NVDAB": ("0x02fca66c1d1afb4e2a7884261eb00f63598a7436", "ui"),
    "AAPLB": ("0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a", "ui"),
    "NVDAon": ("0xa9ee28c80f960b889dfbd1902055218cba016f75", "feed"),
    "AAPLon": ("0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4", "feed"),
}
SEL = {"ui": "0xa60bf13d", "multiplier": "0x1b3ed722", "balanceOf": "0x70a08231",
       "allowance": "0xdd62ed3e", "approve": "0x095ea7b3"}
PUBLIC_UA = {"Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)"}


class ApiError(Exception):
    def __init__(self, path, res):
        body = res.get("body") if isinstance(res, dict) else res
        super().__init__(f"{path}: http={res.get('http')} body={json.dumps(body)[:400]}")
        self.res = res


class Client:
    def __init__(self, key=None, secret=None):
        self.key = key or os.environ.get("BINANCE_W3_API_KEY") or getpass.getpass("API key (hidden): ").strip()
        secret = secret or os.environ.get("BINANCE_W3_API_SECRET") or getpass.getpass("API secret (hidden): ").strip()
        self.secret = secret.encode()

    def _request(self, method, path, params=None, body=None):
        qs = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
        request_path = f"{PREFIX}{path}" + (f"?{qs}" if qs else "")
        raw_body = json.dumps(body, separators=(",", ":")) if body is not None else ""
        now = dt.datetime.now(dt.timezone.utc)
        ts = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
        sign = base64.b64encode(hmac.new(self.secret, (ts + method + request_path + raw_body).encode(),
                                         hashlib.sha256).digest()).decode()
        headers = {"X-OC-APIKEY": self.key, "X-OC-TIMESTAMP": ts, "X-OC-SIGN": sign,
                   "X-OC-RECV-WINDOW": "10000", "Accept": "application/json", "User-Agent": "parity-spike/1.0"}
        if raw_body:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(BASE + request_path, data=raw_body.encode() or None,
                                     headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                status, raw = r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = raw[:500]
        res = {"http": status, "body": parsed}
        ok = status == 200 and isinstance(parsed, dict) and str(parsed.get("code")) in ("0", "000000")
        if not ok:
            raise ApiError(path, res)  # note: 40304 (region block) arrives as HTTP 200 with a code
        return parsed.get("data")

    def get(self, path, params):
        return self._request("GET", path, params=params)

    def post(self, path, body):
        return self._request("POST", path, body=body)

    def quote(self, to_token, amount_wei, wallet, from_token=USDT):
        routes = self.get("/api/v1/dex/aggregator/quote", {
            "binanceChainId": CHAIN, "amount": str(amount_wei), "fromTokenAddress": from_token,
            "toTokenAddress": to_token, "userWalletAddress": wallet})
        if not routes:
            raise ApiError("quote", {"http": 200, "body": "no routes"})
        return next((r for r in routes if r.get("isBest")), routes[0]), routes

    def swap(self, to_token, amount_wei, wallet, quote_id, slippage="1", from_token=USDT):
        return self.get("/api/v1/dex/aggregator/swap", {
            "binanceChainId": CHAIN, "amount": str(amount_wei), "fromTokenAddress": from_token,
            "toTokenAddress": to_token, "userWalletAddress": wallet, "quoteId": quote_id,
            "slippagePercent": slippage})


# Python scripts rotate through several public RPCs: publicnode started answering 403 to the
# EC2 box mid-run on 2026-10-01. (forge still uses the single BSC_RPC for forking.)
RPCS = [u for u in [os.environ.get("BSC_RPC"), "https://bsc-dataseed.bnbchain.org",
                    "https://bsc-dataseed1.defibit.io", "https://bsc-rpc.publicnode.com"] if u]


def rpc(method, params, rounds=2):
    """JSON-RPC with failover. Transport errors (403/429/timeouts) rotate to the next endpoint;
    a JSON-RPC error (e.g. execution reverted) is a real answer and is raised as RuntimeError."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    last = None
    for attempt in range(rounds * len(RPCS)):
        url = RPCS[attempt % len(RPCS)]
        try:
            req = urllib.request.Request(url, data=body, headers={"content-type": "application/json",
                                                                  "User-Agent": "curl/8"})
            res = json.load(urllib.request.urlopen(req, timeout=30))
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            last = f"{url}: {e}"
            time.sleep(1 + attempt)
            continue
        if "error" in res:
            raise RuntimeError(f"{method}: {res['error']}")
        return res["result"]
    raise RuntimeError(f"{method}: all RPC endpoints failed; last: {last}")


def word(x):
    return (x[2:].lower() if isinstance(x, str) else hex(x)[2:]).rjust(64, "0")


def erc20_balance(token, account):
    return int(rpc("eth_call", [{"to": token, "data": SEL["balanceOf"] + word(account)}, "latest"]), 16)


def erc20_allowance(token, owner, spender):
    return int(rpc("eth_call", [{"to": token, "data": SEL["allowance"] + word(owner) + word(spender)}, "latest"]), 16)


def public_rwa(address):
    url = ("https://www.binance.com/bapi/defi/v2/public/wallet-direct/buw/wallet/market/token/rwa/"
           f"dynamic/ai?chainId=56&contractAddress={address}")
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=PUBLIC_UA), timeout=30)).get("data") or {}


def multiplier(address, source):
    """Shares per token, scaled 1e18, plus where it came from."""
    if source in ("ui", "multiplier"):
        return int(rpc("eth_call", [{"to": address, "data": SEL[source]}, "latest"]), 16), f"on-chain {source}"
    m = public_rwa(address).get("tokenInfo", {}).get("sharesMultiplier")
    if not m:
        raise RuntimeError(f"no sharesMultiplier for {address}")
    whole, _, frac = m.partition(".")
    return int(whole) * 10**18 + int((frac + "0" * 18)[:18]), "public RWA API sharesMultiplier"


def route_text(q):
    return " > ".join(f"{h['dexProtocol']['dexName']}:{h['toToken']['tokenSymbol']}" for h in q.get("dexRouterList", []))
