"""Chief-engineer EC2 recorder for the fixed Batch 1, using the proven spike legs.

Nothing is signed or sent. The agent runs only --self-test / --dry-run. Runtime
credentials and chain transport belong to the chief engineer's EC2 environment
and are consumed by the existing spike client, never written to the evidence.
$6 fork inputs keep capture_route.py's schema. Depth/reference/integrity evidence
is separate. Every run uses new filenames; existing evidence is never overwritten.
"""

import argparse
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import importlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import unittest

from list_candidates import E18, decimal, load_batch


ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
DEFAULT_LIST = CONTRACTS / "deploy" / "batch-1.json"
READ_PATHS = {
    "/api/v1/dex/market/rwa/tokens",
    "/api/v1/dex/aggregator/quote",
    "/api/v1/dex/aggregator/swap",
}


class CaptureError(ValueError):
    pass


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def safe_error(error):
    """Never serialize exception bodies, headers, configured endpoints or stderr."""
    if isinstance(error, CaptureError):
        return str(error)  # Only the recorder's fixed, non-sensitive messages.
    response = getattr(error, "res", None)
    if isinstance(response, dict):
        body = response.get("body")
        code = body.get("code") if isinstance(body, dict) else None
        http = response.get("http")
        details = [f"{name}={value}" for name, value in (("http", http), ("code", code))
                   if re.fullmatch(r"[0-9]{1,6}", str(value))]
        return type(error).__name__ + (" (" + ", ".join(details) + ")" if details else "")
    return type(error).__name__


def clean_evidence(value):
    """Keep the CLI's check evidence without retaining endpoint diagnostics."""
    if isinstance(value, dict):
        return {k: clean_evidence(v) for k, v in value.items()
                if k.lower() not in {"key", "secret", "api_key", "api_secret", "privatekey", "headers", "rpc", "rpcurl"}}
    if isinstance(value, list):
        return [clean_evidence(v) for v in value]
    if isinstance(value, str):
        return re.sub(r"https?://[^\s\"<>]+", "[endpoint omitted]", value)
    return value


class Pacer:
    def __init__(self, interval, clock=time.monotonic, sleep=time.sleep):
        self.interval = float(interval)  # Timing only; all amount/price maths use Decimal/int.
        self.clock = clock
        self.sleep = sleep
        self.last = None

    def wait(self):
        now = self.clock()
        if self.last is not None:
            delay = self.interval - (now - self.last)
            if delay > 0:
                self.sleep(delay)
        self.last = self.clock()


def pace_client(client, pacer):
    original = client._request

    def request(method, path, params=None, body=None):
        if method != "GET" or path not in READ_PATHS or body is not None:
            raise CaptureError("recorder refuses non-read requests")
        pacer.wait()
        return original(method, path, params=params)

    client._request = request
    return client


def import_spike(rows):
    sys.path.insert(0, str(ROOT / "spike"))
    w = importlib.import_module("w3api")
    cr = importlib.import_module("capture_route")
    for row in rows:
        entry = (row["address"], row["multiplierSource"])
        if row["symbol"] in w.TOKENS and tuple(w.TOKENS[row["symbol"]]) != entry:
            raise CaptureError("batch conflicts with an existing spike token")
        w.TOKENS[row["symbol"]] = entry
    return w, cr


def reference_row(rows, token):
    if not isinstance(rows, list):
        raise CaptureError("authenticated RWA list is unavailable")
    matches = [r for r in rows if str(r.get("binanceChainId")) == "56"
               and str(r.get("tokenContractAddress", "")).lower() == token["address"].lower()]
    if len(matches) != 1:
        raise CaptureError("authenticated list must contain exactly one matching BSC token")
    row = matches[0]
    if row.get("tokenSymbol") != token["symbol"] or row.get("underlyingTicker") != token["ticker"]:
        raise CaptureError("authenticated token identity differs from fixed batch")
    try:
        fair = decimal(row.get("referencePrice"))
        ratio = decimal(row.get("tokenToShareRatio"))
    except ValueError:
        raise CaptureError("authenticated reference price or ratio unavailable") from None
    raw_decimals = str(row.get("decimals"))
    if fair <= 0 or ratio <= 0 or not raw_decimals.isdigit() or not 0 <= int(raw_decimals) <= 36:
        raise CaptureError("reference price, ratio or token decimals unavailable")
    with localcontext() as context:
        context.prec = 80
        price = fair / ratio
    return {"source": "authenticated /api/v1/dex/market/rwa/tokens",
            "tokenContractAddress": token["address"], "binanceChainId": "56",
            "tokenSymbol": token["symbol"], "underlyingTicker": token["ticker"],
            "referencePricePerTokenUsd": str(fair), "tokenToShareRatio": str(ratio),
            "decimals": int(raw_decimals), "referencePricePerShareUsd": str(price)}


def inspection_row(payload, token):
    matches = [r for r in payload.get("tokens", [])
               if str(r.get("address", "")).lower() == token["address"].lower()]
    if len(matches) != 1:
        raise CaptureError("CLI facts must contain exactly one matching token")
    row = matches[0]
    if row.get("symbol") != token["symbol"] or row.get("issuer") != token["kind"]:
        raise CaptureError("CLI token identity differs from fixed batch")
    if (row.get("integrity") or {}).get("grade") not in {"A", "B", "C", "D", "F"}:
        raise CaptureError("CLI integrity grade unavailable")
    return {"source": f"pnpm --silent tally facts {token['ticker']} --json",
            "asOf": payload.get("asOf"), "inspection": clean_evidence(row)}


def cli_facts(token):
    result = subprocess.run(["pnpm", "--silent", "tally", "facts", token["ticker"], "--json"],
                            cwd=ROOT, capture_output=True, text=True, timeout=180, check=False)
    if result.returncode:
        raise CaptureError("CLI facts command failed")
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        raise CaptureError("CLI facts did not return JSON") from None
    return inspection_row(payload, token)


def failed_leg(wallet, error):
    return {"user": wallet, "replayable": "false", "error": safe_error(error),
            "router": "", "data": "0x", "approveTarget": "", "value": "0",
            "minReceive": "0", "toTokenAmount": "0", "mode": "ERROR"}


def assess_quote(quote, amount, reference, multiplier, limit_pct, require_swap_build=False):
    result = {"amountInUsdtE18": str(amount), "premiumPct": None,
              "quotedPricePerShareUsd": None, "sharesOut": None, "pass": False, "reasons": []}
    if quote.get("mode") != "SWAP":
        result["reasons"].append("executionMode is not SWAP")
    if not str(quote.get("routeCount")).isdigit() or int(quote["routeCount"]) <= 0:
        result["reasons"].append("no quoted route")
    if require_swap_build and (quote.get("swapMode") != "SWAP" or quote.get("replayable") != "true"):
        result["reasons"].append("$6 swap calldata is not replayable SWAP")
    try:
        if reference is None or multiplier is None:
            raise CaptureError("reference or captured multiplier unavailable")
        raw = str(quote.get("toTokenAmount"))
        if not raw.isdigit() or int(raw) <= 0 or not 0 < multiplier < 2**256:
            raise CaptureError("positive token output and multiplier required")
        with localcontext() as context:
            context.prec = 80
            ratio = Decimal(multiplier) / E18
            shares = Decimal(raw) / (10 ** reference["decimals"]) * ratio
            price = Decimal(amount) / E18 / shares
            ref = Decimal(reference["referencePricePerShareUsd"])
            premium = (price / ref - 1) * 100
            result.update({"sharesOut": str(shares), "quotedPricePerShareUsd": str(price), "premiumPct": str(premium)})
            if abs(premium) > limit_pct:
                result["reasons"].append(f"absolute premium exceeds {limit_pct}%")
            auth_ratio = Decimal(reference["tokenToShareRatio"])
            if abs(ratio - auth_ratio) * 1000 > min(ratio, auth_ratio):
                result["reasons"].append("captured multiplier and authenticated ratio differ by more than 0.1%")
    except (ValueError, KeyError, TypeError, ArithmeticError):
        result["reasons"].append("cannot compute share price from recorded reference, output and multiplier")
    result["pass"] = not result["reasons"]
    return result


def integrity_assessment(evidence):
    if evidence is None:
        return {"pass": False, "grade": None, "label": "Unavailable", "reasons": ["CLI integrity evidence unavailable"]}
    row = evidence["inspection"]
    integrity = row["integrity"]
    blocked = row.get("executable") is not True or "ghost" in integrity.get("flags", [])
    return {"pass": not blocked, "grade": integrity["grade"],
            "label": "Not Tradable" if blocked else "Tradable",
            "reasons": [row.get("blockedReason") or "Not Tradable"] if blocked else []}


def quote_only(client, address, amount, wallet):
    quote, routes = client.quote(address, amount, wallet)
    return {"user": wallet, "mode": quote.get("executionMode"), "vendor": quote.get("vendorName"),
            "routeCount": str(len(routes)), "quoteId": quote.get("quoteId"),
            "toTokenAmount": str(quote.get("toTokenAmount")),
            "priceImpactPercent": str(quote.get("priceImpactPercent")), "tradeFee": str(quote.get("tradeFee"))}


def write_new_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")


def capture_one(token, client, w, cr, cap_path, depth_path, limit_pct, get_facts=cli_facts):
    depth = {"schema": 1, "token": token["symbol"], "tokenAddress": token["address"],
             "ticker": token["ticker"], "kind": token["kind"], "role": token["role"], "held": token["held"],
             "capturedAtUtc": utc_now(), "premiumLimitPct": str(limit_pct), "reference": None,
             "integrityEvidence": None, "quotes": {}, "errors": [], "forkCapture": str(cap_path.relative_to(CONTRACTS)),
             "gates": {"depth": "failed", "fork": "pending", "enablement": "not approved"}}
    # Run the engine first; its own request pacing is kept intact. No CLI network
    # traffic overlaps the spike client, whose every authenticated call is paced.
    try:
        depth["integrityEvidence"] = get_facts(token)
    except Exception as error:  # CLI failures must not prevent quote evidence for this asset.
        depth["errors"].append({"stage": "integrity", "reason": safe_error(error)})
    try:
        rows = client._request("GET", "/api/v1/dex/market/rwa/tokens", {"chainId": "56"})
        depth["reference"] = reference_row(rows, token)
    except Exception as error:  # Missing facts are recorded; no inferred reference/ratio.
        depth["errors"].append({"stage": "reference", "reason": safe_error(error)})
    multiplier = None
    cap = None
    try:
        multiplier, source = w.multiplier(token["address"], token["multiplierSource"])
        if not isinstance(multiplier, int) or not 0 < multiplier < 2**256:
            raise CaptureError("captured multiplier unavailable")
        # Exactly capture_route.py's top-level fork schema; no depth-only fields.
        public_ref = w.public_rwa(token["address"]).get("stockInfo", {}).get("price")
        cap = {"token": token["symbol"], "tokenAddress": token["address"], "tokenIn": w.USDT,
               "amountIn": str(6 * E18), "multiplierSource": token["multiplierSource"],
               "multiplier": str(multiplier), "multiplierFrom": source, "referencePrice": str(public_ref),
               "capturedAtUtc": utc_now(), "blockAtCapture": str(int(w.rpc("eth_blockNumber", []), 16))}
    except Exception as error:  # Keep $100/ref/grade evidence even when fork preparation fails.
        depth["errors"].append({"stage": "fork preparation", "reason": safe_error(error)})
    wallets = [("eoa", w.TEST_USER), ("guard", w.GUARD_ADDR)]
    amounts = [6, 100] if token["kind"] == "bstock" else [6]
    for dollars in amounts:
        quotes = depth["quotes"][str(dollars)] = {}
        for name, wallet in wallets:
            try:
                quote = (cr.leg(client, token["address"], dollars * E18, wallet, "1") if dollars == 6
                         else quote_only(client, token["address"], dollars * E18, wallet))
            except Exception as error:  # No retry or automatic execution; record each failed leg.
                quote = failed_leg(wallet, error)
            if dollars == 6 and cap is not None:
                cap[name] = quote
            quotes[name] = {"quote": quote, "assessment": assess_quote(
                quote, dollars * E18, depth["reference"], multiplier, limit_pct, require_swap_build=dollars == 6)}
    if cap is not None:
        write_new_json(cap_path, cap)
    depth["integrityAssessment"] = integrity_assessment(depth["integrityEvidence"])
    depth_pass = (cap is not None and not depth["errors"] and depth["integrityAssessment"]["pass"]
                  and all(q["assessment"]["pass"] for qs in depth["quotes"].values() for q in qs.values()))
    depth["gates"]["depth"] = "passed" if depth_pass else "failed"
    write_new_json(depth_path, depth)
    return depth


def result_line(depth):
    premiums = []
    for amount, wallets in depth["quotes"].items():
        for name, quote in wallets.items():
            premium = quote["assessment"]["premiumPct"]
            shown = "unavailable" if premium is None else f"{Decimal(premium):+.4f}%"
            premiums.append(f"${amount}/{name}={shown}")
    verdict = depth.get("integrityAssessment", {})
    reasons = [f"{e['stage']}: {e['reason']}" for e in depth["errors"]]
    reasons += verdict.get("reasons", [])
    for amount, wallets in depth["quotes"].items():
        for name, quote in wallets.items():
            reasons += [f"${amount}/{name}: {reason}" for reason in quote["assessment"]["reasons"]]
    return (f"{depth['token']} DEPTH {depth['gates']['depth'].upper()} {' '.join(premiums)} "
            f"grade={verdict.get('grade') or 'unavailable'} held={'yes' if depth['held'] else 'no'} "
            f"fork=pending enablement=not-approved" + (" reasons=" + "; ".join(reasons) if reasons else ""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", type=Path, default=DEFAULT_LIST)
    parser.add_argument("--list-tokens", action="store_true")
    parser.add_argument("--token")
    parser.add_argument("--run-id")
    parser.add_argument("--request-interval", default="0.5")
    parser.add_argument("--premium-limit-pct", default="1.5")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(CaptureTests)
        return 0 if unittest.TextTestRunner().run(suite).wasSuccessful() else 1
    batch = load_batch(args.list)
    if args.list_tokens:
        print("\n".join(row["symbol"] for row in batch["tokens"]))
        return 0
    matches = [r for r in batch["tokens"] if r["symbol"] == args.token]
    if len(matches) != 1:
        parser.error("--token must be in the fixed Batch 1/control list")
    if not args.run_id or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", args.run_id):
        parser.error("--run-id must be 1-80 letters, digits, underscores or hyphens")
    interval = decimal(args.request_interval)
    limit = decimal(args.premium_limit_pct)
    if interval < Decimal("0.25") or limit <= 0:
        parser.error("request interval must be >=0.25 seconds; premium limit must be positive")
    token = matches[0]
    cap_path = CONTRACTS / "captures" / f"{token['symbol']}.{args.run_id}.json"
    depth_path = CONTRACTS / "captures" / "depth" / args.run_id / f"{token['symbol']}.json"
    if cap_path.exists() or depth_path.exists():
        raise CaptureError("recording exists; choose a new run id to preserve existing evidence")
    if args.dry_run:
        sizes = "$6 + $100" if token["kind"] == "bstock" else "$6"
        print(f"{token['symbol']} DRY RUN {sizes} held={'yes' if token['held'] else 'no'} fork={cap_path.relative_to(CONTRACTS)}")
        return 0
    # Only the chief engineer runs this path on EC2. Never prompt for credentials.
    if not all(os.environ.get(name) for name in ("BINANCE_W3_API_KEY", "BINANCE_W3_API_SECRET")):
        raise CaptureError("EC2 recorder credentials are not configured")
    w, cr = import_spike(batch["tokens"])
    client = pace_client(w.Client(), Pacer(interval))
    depth = capture_one(token, client, w, cr, cap_path, depth_path, limit)
    print(result_line(depth))
    return 0 if depth["gates"]["depth"] == "passed" else 1


class CaptureTests(unittest.TestCase):
    """Real cr.leg against constructed transports, with all network/secret reads blocked."""

    class Client:
        def __init__(self, auth):
            self.auth = auth
            self.quotes = []
            self.swaps = []
            self.fail_first = False

        def _request(self, method, path, params=None, body=None):
            return self.auth

        def quote(self, address, amount, wallet):
            self.quotes.append((amount, wallet))
            if self.fail_first and len(self.quotes) == 1:
                raise RuntimeError("sensitive upstream diagnostic")
            q = {"executionMode": "SWAP", "vendorName": "fixture", "quoteId": "fixture-id",
                 "toTokenAmount": str(amount // 6), "priceImpactPercent": "0", "tradeFee": "0",
                 "approveTarget": "0x" + "3" * 40}
            return q, [q]

        def swap(self, address, amount, wallet, quote_id, slippage):
            self.swaps.append(amount)
            return {"executionMode": "SWAP", "tx": {"to": "0x" + "3" * 40,
                    "data": "0x12345678", "value": "0", "gas": "550000", "minReceiveAmount": str(amount // 6)}}

    def setUp(self):
        from contextlib import ExitStack
        import getpass
        import tempfile
        import urllib.request
        from unittest.mock import patch
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(os, "environ", {}))
        self.stack.enter_context(patch.object(urllib.request, "urlopen", side_effect=AssertionError("network forbidden")))
        self.stack.enter_context(patch.object(getpass, "getpass", side_effect=AssertionError("credential prompts forbidden")))
        self.rows = load_batch(DEFAULT_LIST)["tokens"]
        self.w, self.cr = import_spike(self.rows)
        self.stack.enter_context(patch.object(self.w, "multiplier", return_value=(10 * E18, "constructed source")))
        self.stack.enter_context(patch.object(self.w, "public_rwa", return_value={"stockInfo": {"price": None}}))
        self.stack.enter_context(patch.object(self.w, "rpc", return_value="0x64"))
        directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.contracts = Path(directory)
        self.stack.enter_context(patch(__name__ + ".CONTRACTS", self.contracts))

    def auth(self, token):
        return [{"binanceChainId": "56", "tokenContractAddress": token["address"],
                 "tokenSymbol": token["symbol"], "underlyingTicker": token["ticker"],
                 "referencePrice": "6", "tokenToShareRatio": "10", "decimals": "18"}]

    def facts(self, token):
        return inspection_row({"asOf": "2026-10-07T00:00:00Z", "tokens": [
            {"symbol": token["symbol"], "issuer": token["kind"], "address": token["address"],
             "executable": True, "integrity": {"grade": "A", "score": 100, "flags": [], "checks": []}}]}, token)

    def capture(self, token, client=None, facts=None):
        client = client or self.Client(self.auth(token))
        cap = self.contracts / "captures" / f"{token['symbol']}.offline.json"
        depth = self.contracts / "captures" / "depth" / "offline" / f"{token['symbol']}.json"
        result = capture_one(token, client, self.w, self.cr, cap, depth, Decimal("1.5"), get_facts=facts or self.facts)
        return result, cap, depth, client

    def test_real_spike_leg_preserves_recorded_fork_schema_and_separates_depth(self):
        result, cap_path, depth_path, client = self.capture(self.rows[0])
        cap = json.loads(cap_path.read_text())
        recorded = json.loads((ROOT / "contracts" / "captures" / "NVDAB.json").read_text())
        self.assertEqual(set(cap), set(recorded))
        self.assertEqual(set(cap["eoa"]), set(recorded["eoa"]))
        self.assertEqual(set(cap["guard"]), set(recorded["guard"]))
        self.assertEqual(cap["amountIn"], str(6 * E18))
        self.assertEqual(cap["multiplier"], str(10 * E18))
        self.assertNotIn("tokenToShareRatio", cap)
        self.assertEqual(result["reference"]["referencePricePerShareUsd"], "0.6")
        self.assertEqual(result["quotes"]["6"]["guard"]["assessment"]["premiumPct"], "0")
        self.assertEqual([q[0] for q in client.quotes], [6 * E18, 6 * E18, 100 * E18, 100 * E18])
        self.assertEqual(client.swaps, [6 * E18, 6 * E18])
        self.assertEqual(json.loads(depth_path.read_text())["gates"], {"depth": "passed", "fork": "pending", "enablement": "not approved"})

    def test_ondo_gets_only_six_dollars_and_held_asset_stays_held(self):
        token = next(r for r in self.rows if r["kind"] == "ondo" and r["held"])
        result, _, _, client = self.capture(token)
        self.assertEqual(set(result["quotes"]), {"6"})
        self.assertEqual(len(client.quotes), 2)
        self.assertTrue(result["held"])
        self.assertEqual(result["gates"]["enablement"], "not approved")

    def test_failed_six_dollar_leg_does_not_stop_guard_or_hundred_dollar_quotes(self):
        client = self.Client(self.auth(self.rows[0]))
        client.fail_first = True
        result, cap_path, _, _ = self.capture(self.rows[0], client=client)
        cap = json.loads(cap_path.read_text())
        self.assertEqual(cap["eoa"]["replayable"], "false")
        self.assertEqual(cap["guard"]["replayable"], "true")
        self.assertEqual(len(client.quotes), 4)
        self.assertTrue(result["quotes"]["100"]["guard"]["assessment"]["pass"])
        self.assertEqual(result["gates"]["depth"], "failed")
        self.assertNotIn("sensitive", cap_path.read_text())

    def test_missing_integrity_fails_depth_but_still_records_all_quotes(self):
        def failed(_):
            raise RuntimeError("private diagnostic")
        result, _, depth, client = self.capture(self.rows[0], facts=failed)
        self.assertEqual(len(client.quotes), 4)
        self.assertEqual(result["gates"]["depth"], "failed")
        self.assertEqual(result["errors"], [{"stage": "integrity", "reason": "RuntimeError"}])
        self.assertNotIn("private diagnostic", depth.read_text())

    def test_failed_multiplier_still_records_depth_without_invalid_fork_input(self):
        from unittest.mock import patch
        with patch.object(self.w, "multiplier", side_effect=RuntimeError("unreadable")):
            result, cap, depth, client = self.capture(self.rows[0])
        self.assertFalse(cap.exists())
        self.assertTrue(depth.exists())
        self.assertEqual(len(client.quotes), 4)
        self.assertEqual(result["gates"]["depth"], "failed")

    def test_reference_requires_exact_token_positive_price_ratio_and_decimals(self):
        token = self.rows[0]
        for field, value in (("referencePrice", None), ("tokenToShareRatio", None),
                             ("tokenToShareRatio", "0"), ("decimals", None), ("binanceChainId", "1"),
                             ("tokenSymbol", "WRONG")):
            rows = self.auth(token)
            rows[0][field] = value
            with self.assertRaises(CaptureError):
                reference_row(rows, token)
        with self.assertRaises(CaptureError):
            reference_row(self.auth(token) * 2, token)

    def test_premium_threshold_is_exact_inclusive_and_uses_token_decimals(self):
        ref = {"decimals": 6, "referencePricePerShareUsd": "100", "tokenToShareRatio": "1"}
        q = {"mode": "SWAP", "routeCount": "1", "toTokenAmount": "1000000"}
        exact = assess_quote(q, 101500000000000000000, ref, E18, Decimal("1.5"))
        self.assertTrue(exact["pass"])
        self.assertEqual(exact["premiumPct"], "1.500")
        self.assertFalse(assess_quote(q, 101500000000000000001, ref, E18, Decimal("1.5"))["pass"])
        self.assertFalse(assess_quote(q, 98499999999999999999, ref, E18, Decimal("1.5"))["pass"])

    def test_rfq_zero_route_missing_output_and_ratio_disagreement_fail(self):
        ref = {"decimals": 18, "referencePricePerShareUsd": "6", "tokenToShareRatio": "1"}
        base = {"mode": "SWAP", "routeCount": "1", "toTokenAmount": str(E18)}
        for field, value in (("mode", "RFQ"), ("routeCount", "0"), ("toTokenAmount", None)):
            q = {**base, field: value}
            self.assertFalse(assess_quote(q, 6 * E18, ref, E18, Decimal("1.5"))["pass"])
        self.assertFalse(assess_quote(base, 6 * E18, ref, 10 * E18, Decimal("1.5"))["pass"])

    def test_not_tradable_is_engine_executability_or_ghost_not_grade_f(self):
        evidence = self.facts(self.rows[0])
        evidence["inspection"]["integrity"]["grade"] = "F"
        self.assertTrue(integrity_assessment(evidence)["pass"])
        evidence["inspection"]["integrity"]["flags"] = ["ghost"]
        self.assertFalse(integrity_assessment(evidence)["pass"])
        evidence["inspection"]["integrity"]["flags"] = []
        evidence["inspection"]["executable"] = False
        self.assertFalse(integrity_assessment(evidence)["pass"])

    def test_api_errors_and_cli_diagnostics_do_not_persist_endpoints_or_credentials(self):
        error = self.w.ApiError("endpoint", {"http": 200, "body": {"code": 40304, "secret": "DO-NOT-STORE"}})
        self.assertEqual(safe_error(error), "ApiError (http=200, code=40304)")
        data = clean_evidence({"headers": {"secret": "DO-NOT-STORE"}, "note": "failed https://host.invalid/?key=DO-NOT-STORE"})
        self.assertEqual(data, {"note": "failed [endpoint omitted]"})

    def test_existing_recordings_cannot_be_overwritten(self):
        path = self.contracts / "proof.json"
        write_new_json(path, {"original": True})
        with self.assertRaises(FileExistsError):
            write_new_json(path, {"original": False})
        self.assertEqual(json.loads(path.read_text()), {"original": True})

    def test_pacer_spaces_requests_and_read_client_refuses_writes(self):
        clock = [0.0]
        sleeps = []
        def sleep(seconds):
            sleeps.append(seconds)
            clock[0] += seconds
        pacer = Pacer(Decimal("0.5"), clock=lambda: clock[0], sleep=sleep)
        client = pace_client(self.Client([]), pacer)
        for _ in range(3):
            client._request("GET", "/api/v1/dex/market/rwa/tokens", {})
        self.assertEqual(sleeps, [0.5, 0.5])
        with self.assertRaises(CaptureError):
            client._request("POST", "/api/v1/dex/aggregator/swap", {})
        with self.assertRaises(CaptureError):
            client._request("GET", "/api/v1/dex/anything-else", {})

    def test_shell_continues_after_failure_and_keeps_held_last(self):
        # Stub the executable boundary, leaving the actual bash loop under test.
        binary = self.contracts / "bin"
        binary.mkdir()
        log = self.contracts / "tokens.log"
        symbols = [r["symbol"] for r in self.rows]
        stub = binary / "python3"
        text = ("#!/usr/bin/python3\nimport sys\nfrom pathlib import Path\n"
                f"symbols={symbols!r}\nlog=Path({str(log)!r})\n"
                "if '--list-tokens' in sys.argv:\n print('\\n'.join(symbols));sys.exit(0)\n"
                "token=sys.argv[sys.argv.index('--token')+1]\n"
                "with log.open('a') as f:f.write(token+'\\n')\n"
                "print(token+' offline result')\n"
                "sys.exit(1 if token==symbols[0] else 0)\n")
        stub.write_text(text)
        stub.chmod(0o755)
        sleeping = binary / "sleep"
        sleeping.write_text("#!/bin/sh\nexit 0\n")
        sleeping.chmod(0o755)
        result = subprocess.run(["bash", str(ROOT / "contracts" / "script" / "capture_batch.sh"), "--run-id", "offline"],
                                env={"PATH": str(binary) + ":/usr/bin:/bin"}, capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(log.read_text().splitlines(), symbols)
        self.assertIn("52 successful recorder calls, 1 failed", result.stdout)
        self.assertEqual(log.read_text().splitlines()[-8:], [r["symbol"] for r in self.rows if r["held"]])


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"capture failed: {safe_error(error)}; no enablement or retry", file=sys.stderr)
        raise SystemExit(1) from None
