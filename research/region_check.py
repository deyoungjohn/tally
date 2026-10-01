"""Does the Binance Web3 Trading API enforce region/eligibility rules on bStock quotes and swaps?

Run this on your own PC. It is READ-ONLY:
  * it only calls the GET quote / swap-build / approve-build endpoints,
  * it never signs a transaction or an RFQ order and never broadcasts anything,
  * no funds are needed and none can move.

What it does, for each test token (bStock by default, plus Ondo and a plain crypto
pair as controls):
  1. quote without a wallet
  2. quote with a wallet (RFQ tokens like bStock/Ondo need one; this is where a
     per-user/per-region check would most likely happen)
  3. build the swap transaction from that quote (not signed, not sent)
It records every error code and message verbatim and flags anything that looks like
a region/compliance/KYC block. It also records the token's market status from the
public endpoint, so a "market closed" RFQ failure isn't mistaken for a region block.

To actually answer "is region enforced?", run it twice and compare:
  python region_check.py --label home
  (connect a VPN exit in a restricted region, e.g. one on the hackathon list)
  python region_check.py --label vpn-restricted
  python region_check.py --compare region_report_home.json region_report_vpn-restricted.json
Also try --wallet with your own Binance Web3 Wallet address vs the default fresh address.
Run during US regular hours (13:30-20:00 UTC Mon-Fri) so RFQ market makers are quoting.

Credentials: set BINANCE_W3_API_KEY and BINANCE_W3_API_SECRET, or you'll be prompted
(hidden input). They are never printed or written to the report.

Needs Python 3.8+, standard library only.
"""
import argparse
import base64
import datetime as dt
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://web3.binance.com"
PREFIX = "/build"  # must be in both the URL and the signed path, per the auth docs
CHAIN = "56"
USDT = "0x55d398326f99059fF775485246999027B3197955"  # BSC USDT, 18 decimals
WBNB_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
PUBLIC_STATUS = ("https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/"
                 "token/rwa/asset/market/status/ai?chainId=56&contractAddress={}")

TOKENS = [  # (label, issuer, address) - BSC, from research/snapshot-2026-09-30
    ("NVDAB", "bstock", "0x02fca66c1d1afb4e2a7884261eb00f63598a7436"),
    ("AAPLB", "bstock", "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a"),
    ("TSLAB", "bstock", "0x5b1910eaad6450e50f816082aa078c41f10c292f"),
    ("QQQB", "bstock", "0x205812cdbed920aff76c6580abd681a46d11efc7"),
    ("SPYB", "bstock", "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8"),
    ("NVDAon", "ondo (control)", "0xa9ee28c80f960b889dfbd1902055218cba016f75"),
    ("AAPLon", "ondo (control)", "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4"),
    ("BNB", "crypto (control)", WBNB_NATIVE),
]
REGION_WORDS = re.compile(r"region|country|jurisdiction|restrict|compliance|kyc|sanction|"
                          r"not available|unavailable in|not supported in|prohibit|geo|ip", re.I)


class Client:
    def __init__(self, key, secret):
        self.key, self.secret = key, secret.encode()

    def get(self, path, params):
        qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        request_path = f"{PREFIX}{path}?{qs}" if qs else f"{PREFIX}{path}"
        now = dt.datetime.now(dt.timezone.utc)
        ts = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
        sign = base64.b64encode(hmac.new(self.secret, (ts + "GET" + request_path).encode(),
                                         hashlib.sha256).digest()).decode()
        req = urllib.request.Request(BASE + request_path, headers={
            "X-OC-APIKEY": self.key, "X-OC-TIMESTAMP": ts, "X-OC-SIGN": sign,
            "X-OC-RECV-WINDOW": "10000", "Accept": "application/json",
            "User-Agent": "region-check/1.0"})
        started = time.time()
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                status, raw = r.status, r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001 - network errors are results too
            return {"http": None, "error": f"{type(e).__name__}: {e}", "ms": int((time.time() - started) * 1000)}
        try:
            body = json.loads(raw)
        except ValueError:
            body = raw[:500]
        return {"http": status, "body": body, "ms": int((time.time() - started) * 1000)}


def outcome(res):
    """-> (ok, code, message, region_flag)"""
    if res.get("error"):
        return False, "NETWORK", res["error"], False
    body = res.get("body")
    if not isinstance(body, dict):
        msg = str(body)
        return False, f"HTTP{res['http']}", msg, bool(REGION_WORDS.search(msg)) or res["http"] in (403, 451)
    code = str(body.get("code", ""))
    msg = str(body.get("msg") or body.get("message") or body.get("messageDetail") or "")
    ok = res["http"] == 200 and code in ("0", "000000", "") and body.get("data") not in (None, [], {})
    flag = bool(REGION_WORDS.search(msg)) or res["http"] in (403, 451)
    return ok, code or f"HTTP{res['http']}", msg, flag


def first_route(body):
    data = body.get("data") if isinstance(body, dict) else None
    if isinstance(data, dict):
        data = data.get("routes") or data.get("list") or [data]
    if not isinstance(data, list) or not data:
        return None
    best = next((r for r in data if isinstance(r, dict) and r.get("isBest")), data[0])
    return best if isinstance(best, dict) else None


def market_status(address):
    if address == WBNB_NATIVE:
        return "n/a (crypto)"
    try:
        req = urllib.request.Request(PUBLIC_STATUS.format(address),
                                     headers={"Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)"})
        d = json.load(urllib.request.urlopen(req, timeout=20)).get("data") or {}
        return f"{d.get('reasonCode')}/{d.get('marketStatus')}"
    except Exception as e:  # noqa: BLE001
        return f"unknown ({type(e).__name__})"


def run(args):
    key = os.environ.get("BINANCE_W3_API_KEY") or getpass.getpass("API key (hidden): ").strip()
    secret = os.environ.get("BINANCE_W3_API_SECRET") or getpass.getpass("API secret (hidden): ").strip()
    client = Client(key, secret)
    wallet = args.wallet or "0x" + secrets.token_hex(20)
    amount = str(int(args.usdt * 10**18)) if args.amount_units == "raw" else str(args.usdt)

    report = {"label": args.label, "run_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
              "wallet": wallet, "wallet_kind": "yours" if args.wallet else "fresh random",
              "amount": amount, "amount_units": args.amount_units, "results": []}
    if args.geo:  # opt-in: sends your IP to ipinfo.io to record which country the API sees
        try:
            g = json.load(urllib.request.urlopen("https://ipinfo.io/json", timeout=10))
            report["caller_ip_country"] = g.get("country")
        except Exception as e:  # noqa: BLE001
            report["caller_ip_country"] = f"unknown ({type(e).__name__})"

    # 0. auth sanity: a call with no token involved
    res = client.get("/api/v1/dex/aggregator/supported/chain", {"binanceChainId": CHAIN})
    ok, code, msg, _ = outcome(res)
    print(f"auth check (supported/chain): {'OK' if ok else 'FAIL'} {code} {msg}")
    report["auth_check"] = {"ok": ok, "code": code, "msg": msg, "http": res.get("http")}
    if not ok:
        print("Stopping: fix the key/secret/clock first (40102 = bad signature, check your PC clock).")
        return report

    print(f"\nwallet used for RFQ: {wallet} ({report['wallet_kind']}), amount {amount} ({args.amount_units})")
    print(f"{'token':8s} {'issuer':16s} {'mkt status':22s} {'quote(no wallet)':22s} "
          f"{'quote(wallet)':22s} {'swap build':22s}")
    for label, issuer, addr in TOKENS:
        row = {"token": label, "issuer": issuer, "address": addr, "market_status": market_status(addr)}
        base = {"binanceChainId": CHAIN, "amount": amount, "fromTokenAddress": USDT, "toTokenAddress": addr}
        cells = []
        for step, params in [("quote_no_wallet", base), ("quote_wallet", {**base, "userWalletAddress": wallet})]:
            res = client.get("/api/v1/dex/aggregator/quote", params)
            ok, code, msg, flag = outcome(res)
            route = first_route(res.get("body")) if ok else None
            row[step] = {"ok": ok, "code": code, "msg": msg, "region_flag": flag, "http": res.get("http"),
                         "ms": res.get("ms"), "vendor": route and route.get("vendorName"),
                         "mode": route and route.get("executionMode"), "quoteId": route and route.get("quoteId"),
                         "toTokenAmount": route and route.get("toTokenAmount"), "raw": res.get("body")}
            cells.append(("OK " + str(row[step]["mode"] or "")) if ok else f"{'REGION? ' if flag else ''}{code}")
            time.sleep(0.4)
        q = row["quote_wallet"]
        if q["ok"] and q["quoteId"]:
            res = client.get("/api/v1/dex/aggregator/swap", {**base, "userWalletAddress": wallet,
                                                             "quoteId": q["quoteId"], "slippagePercent": "1"})
            ok, code, msg, flag = outcome(res)
            row["swap_build"] = {"ok": ok, "code": code, "msg": msg, "region_flag": flag,
                                 "http": res.get("http"), "raw": res.get("body")}
            cells.append("OK (not sent)" if ok else f"{'REGION? ' if flag else ''}{code}")
        else:
            row["swap_build"] = {"skipped": "no quote with wallet"}
            cells.append("skipped")
        report["results"].append(row)
        print(f"{label:8s} {issuer:16s} {row['market_status']:22s} " + " ".join(f"{c:22s}" for c in cells))
        time.sleep(0.4)

    print("\nError messages (verbatim):")
    for r in report["results"]:
        for step in ("quote_no_wallet", "quote_wallet", "swap_build"):
            s = r.get(step, {})
            if s.get("ok") is False:
                print(f"  {r['token']:8s} {step:16s} http={s.get('http')} code={s.get('code')} "
                      f"{'[REGION?] ' if s.get('region_flag') else ''}{s.get('msg')}")
    print_verdict(report)
    return report


def print_verdict(report):
    rs = report["results"]
    b = [r for r in rs if r["issuer"] == "bstock"]
    flags = [r["token"] for r in rs for s in ("quote_no_wallet", "quote_wallet", "swap_build")
             if r.get(s, {}).get("region_flag")]
    b_ok = [r["token"] for r in b if r.get("swap_build", {}).get("ok")]
    closed = [r["token"] for r in b if "TRADING" not in str(r["market_status"])]
    print("\nVerdict for this run:")
    if flags:
        print(f"  Region/compliance-looking errors on: {sorted(set(flags))}. Read the verbatim messages above.")
    if b_ok:
        print(f"  bStock swap transactions were built for {b_ok} for wallet {report['wallet']} "
              f"({report['wallet_kind']}): no region block at the API layer from this location.")
    elif not flags:
        print("  No bStock swap was built, but no error mentions region either; see codes above.")
    if closed:
        print(f"  Note: {closed} were not in TRADING status; RFQ failures there may just be market hours.")
    print("  One run can't prove enforcement. Compare against a run from a restricted-region IP (--compare).")


def compare(a_path, b_path):
    a, b = (json.load(open(p)) for p in (a_path, b_path))
    print(f"A = {a['label']} (ip country {a.get('caller_ip_country', '?')}, wallet {a['wallet_kind']})")
    print(f"B = {b['label']} (ip country {b.get('caller_ip_country', '?')}, wallet {b['wallet_kind']})")
    bi = {r["token"]: r for r in b["results"]}
    for r in a["results"]:
        o = bi.get(r["token"], {})
        for step in ("quote_no_wallet", "quote_wallet", "swap_build"):
            x, y = r.get(step, {}), o.get(step, {})
            if x.get("ok") != y.get("ok") or x.get("code") != y.get("code"):
                print(f"  DIFF {r['token']:8s} {step:16s} A: {x.get('ok')} {x.get('code')} {x.get('msg', '')[:60]!r}"
                      f" | B: {y.get('ok')} {y.get('code')} {y.get('msg', '')[:60]!r}")
    print("No DIFF lines = the API behaved the same from both places.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--label", default="run", help="name for this run, e.g. home / vpn-restricted")
    p.add_argument("--wallet", help="your wallet address (default: a fresh random address)")
    p.add_argument("--usdt", type=float, default=10.0, help="quote size in USDT (default 10)")
    p.add_argument("--amount-units", choices=["raw", "human"], default="raw",
                   help="send amount as raw 18-decimal units (default) or human units; "
                        "if every quote returns 40001 PARAM_ERROR, try the other")
    p.add_argument("--geo", action="store_true", help="record your IP country via ipinfo.io (sends your IP there)")
    p.add_argument("--compare", nargs=2, metavar=("A.json", "B.json"), help="diff two saved reports")
    args = p.parse_args()
    if args.compare:
        return compare(*args.compare)
    report = run(args)
    out = f"region_report_{re.sub(r'[^A-Za-z0-9_-]', '_', args.label)}.json"
    with open(out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nSaved {out} (contains no credentials).")


if __name__ == "__main__":
    sys.exit(main())
