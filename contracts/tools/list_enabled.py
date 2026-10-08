"""Read deployed ShareGuard configuration and compare the planned list, without keys.

Checks both directions within the fixed 53-token Batch 1 registry. Other registry
tokens cannot be enumerated from ShareGuard's private mapping and are outside this
report's coverage. Before the owner steps, the 20 missing additions are expected.
No signing, writes, credentials, configured RPC URLs or seed reads.
"""

import argparse
import hashlib
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import time
import unittest
import urllib.error
import urllib.request

from gen_buyable import ASSETS, CONTRACTS, OUTPUT, render, validate_manifest
from list_candidates import load_batch

GUARD = "0x28F6F19bffbF25E36452c78d12090F0bC922970a"
ASSET_SELECTOR = "0x71f96211"
BATCH2_SYMBOLS = ["AMZNB", "NFLXB", "GMEB", "BMNRB", "MRNAB", "FLNCB"]
BATCH2_MANIFEST = CONTRACTS / "captures/depth/batch-2-bstock-manifest.json"
BATCH2_SHA256 = "59b73585f741e387878c9907988ffa400a2178596512d34b8e9727147d7ed72f"


def read_rpc(method, params):
    if method not in {"eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call"}:
        raise ValueError("non-read RPC method refused")
    if method == "eth_call":
        if params[0].get("to", "").lower() != GUARD.lower() or params[0].get("data", "")[:10] not in {
                ASSET_SELECTOR, "0x8da5cb5b", "0x5c975abb"}:
            raise ValueError("unexpected ShareGuard read")
    # Public transport only; never read or record private provider configuration.
    endpoint = "https://" + ".".join(["-".join(["bsc", "dataseed"]), "binance", "org"])
    request = urllib.request.Request(endpoint, method="POST", headers={"Content-Type": "application/json"},
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode())
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.load(response)
            if payload.get("error") or payload.get("result") is None:
                raise ValueError("public RPC refused read")
            return payload["result"]
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise ValueError("public RPC transport unavailable") from None
            time.sleep(attempt + 1)


def asset_config(raw):
    if not isinstance(raw, str) or not re.fullmatch(r"0x[0-9a-fA-F]{320}", raw):
        raise ValueError("assetOf did not return five ABI words")
    words = [int(raw[2+i*64:2+(i+1)*64], 16) for i in range(5)]
    if words[0] > 3 or words[1] > 1 or words[2] > 65535 or words[3] > 2 or words[4] >= 2**160:
        raise ValueError("invalid asset configuration encoding")
    return {"source": words[0], "enabled": bool(words[1]), "maxStepBps": words[2],
            "pauseCheck": words[3], "pauseManager": "0x" + format(words[4], "040x")}


def compare(manifest, batch, readings, generated):
    expected_rows = validate_manifest(manifest, batch)
    expected = {r["address"].lower(): r for r in expected_rows}
    missing, unexpected, different, unavailable = [], [], [], []
    active_tickers = set()
    for row in readings:
        address, cfg = row["address"].lower(), row.get("config")
        target = expected.get(address)
        if cfg is None:
            unavailable.append({"token": row["symbol"], "reason": row["reason"]})
            continue
        enabled = cfg["source"] != 0 and cfg["enabled"]
        if enabled:
            active_tickers.add(row["ticker"])
        if target and not enabled:
            missing.append(row["symbol"])
        if not target and enabled:
            unexpected.append(row["symbol"])
        if target and cfg["source"] != 0:
            wanted = {"source": 1 if target["kind"] == "bstock" else 3, "enabled": True,
                      "maxStepBps": 0 if target["kind"] == "bstock" else 300, "pauseCheck": 1,
                      "pauseManager": manifest["bstockPauseManager"].lower() if target["kind"] == "bstock" else "0x"+"0"*40}
            if cfg != wanted:
                different.append({"token": row["symbol"], "actual": cfg, "expected": wanted})
    if {r["address"].lower() for r in readings} != {r["address"].lower() for r in batch["tokens"]} or len(readings) != 53:
        raise ValueError("comparison requires one reading for each fixed Batch 1 token")
    desired_tickers = {r["ticker"] for r in expected_rows}
    generated_matches = generated == render(manifest, batch)
    result = {"missingTokens": missing, "unexpectedEnabledTokens": unexpected, "configurationDifferences": different,
              "unavailable": unavailable, "generatedFileMatchesManifest": generated_matches,
              "tickersMissingOnChain": sorted(desired_tickers-active_tickers),
              "tickersMissingFromGeneratedTarget": sorted(active_tickers-desired_tickers)}
    result["pass"] = not (missing or unexpected or different or unavailable) and generated_matches
    return result


def batch2_manifest():
    raw = BATCH2_MANIFEST.read_bytes()
    if hashlib.sha256(raw).hexdigest() != BATCH2_SHA256:
        raise ValueError("Batch 2 manifest differs from pinned bytes")
    return json.loads(raw)


def compare_batch2(manifest, batch, readings, generated, second):
    result = compare(manifest, batch, readings, generated)
    rows = second["assets"]
    if second["count"] != 6 or [r["symbol"] for r in rows] != BATCH2_SYMBOLS:
        raise ValueError("Batch 2 scope differs")
    known = {r["symbol"]: r for r in batch["tokens"]}
    baseline = validate_manifest(manifest, batch)
    if second["bstockPauseManager"].lower() != manifest["bstockPauseManager"].lower():
        raise ValueError("Batch 2 manager differs")
    for row in rows:
        source = known.get(row["symbol"])
        if (source is None or source["held"] or source["role"] != "candidate" or row["kind"] != "bstock"
                or row["ticker"] != source["ticker"] or row["address"].lower() != source["address"].lower()
                or any(row["address"].lower() == old["address"].lower() for old in baseline)):
            raise ValueError("Batch 2 token identity differs")
    symbols = {r["symbol"] for r in rows}
    result["unexpectedEnabledTokens"] = [s for s in result["unexpectedEnabledTokens"] if s not in symbols]
    actual = {r["symbol"]: r for r in readings}
    for row in rows:
        cfg = actual[row["symbol"]].get("config")
        if cfg is None:
            continue  # The first comparison already records this unavailable read.
        if cfg["source"] == 0 or not cfg["enabled"]:
            result["missingTokens"].append(row["symbol"])
        if cfg["source"] != 0:
            wanted = {"source": 1, "enabled": True, "maxStepBps": 0, "pauseCheck": 1,
                      "pauseManager": manifest["bstockPauseManager"].lower()}
            if cfg != wanted:
                result["configurationDifferences"].append({"token": row["symbol"], "actual": cfg, "expected": wanted})
    desired = {r["ticker"] for r in baseline + rows}
    enabled = {r["ticker"] for r in readings if r.get("config") is not None
               and r["config"]["source"] != 0 and r["config"]["enabled"]}
    result["tickersMissingOnChain"] = sorted(desired-enabled)
    result["tickersMissingFromCombinedManifest"] = sorted(enabled-desired)
    result["productTickersAwaitingBatch2"] = sorted(desired-{r["ticker"] for r in baseline})
    result["scope"] = "first 30 tokens plus pinned Batch 2 six; generated product remains first batch only"
    result["expectedEnabledTokens"] = 36
    result["expectedTickers"] = len(desired)
    result["batch2NotConnectedToProduct"] = BATCH2_SYMBOLS
    result["pass"] = not any(result[k] for k in ("missingTokens", "unexpectedEnabledTokens",
                          "configurationDifferences", "unavailable", "tickersMissingOnChain",
                          "tickersMissingFromCombinedManifest")) and result["generatedFileMatchesManifest"]
    return result


def capture(manifest, batch, generated, rpc=read_rpc, sleep=time.sleep):
    if int(rpc("eth_chainId", []), 16) != 56:
        raise ValueError("expected BSC chain 56")
    block = rpc("eth_blockNumber", [])
    stamp = rpc("eth_getBlockByNumber", [block, False])
    if rpc("eth_getCode", [GUARD, block]) == "0x":
        raise ValueError("deployed ShareGuard code unavailable")
    owner_raw = rpc("eth_call", [{"to": GUARD, "data": "0x8da5cb5b"}, block])
    paused_raw = rpc("eth_call", [{"to": GUARD, "data": "0x5c975abb"}, block])
    readings = []
    for token in batch["tokens"]:
        row = {k: token[k] for k in ("symbol", "ticker", "address", "kind", "role", "held")}
        data = ASSET_SELECTOR + token["address"][2:].lower().rjust(64, "0")
        try:
            row.update(config=asset_config(rpc("eth_call", [{"to": GUARD, "data": data}, block])), reason=None)
        except ValueError:
            row.update(config=None, reason="assetOf read unavailable or invalid")
        readings.append(row)
        sleep(0.25)
    return {"schema": 1, "chainId": 56, "guard": GUARD, "blockNumber": int(block,16),
            "blockUtc": datetime.fromtimestamp(int(stamp["timestamp"],16), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "capturedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "owner": "0x" + format(int(owner_raw,16), "064x")[-40:], "guardPaused": bool(int(paused_raw,16)),
            "coverage": "fixed 53-token Batch 1 registry; cannot enumerate unknown mapping keys",
            "readings": readings, "comparison": compare(manifest, batch, readings, generated)}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--snapshot", type=Path)
    p.add_argument("--recorded", type=Path, help="compare recorded chain readings offline")
    p.add_argument("--self-test", action="store_true")
    p.add_argument("--batch2", action="store_true", help="verify the pinned six additions plus the first 30; do not generate or connect product data")
    args = p.parse_args()
    if args.self_test:
        return 0 if unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests)).wasSuccessful() else 1
    manifest = json.loads(ASSETS.read_text())
    batch = load_batch(CONTRACTS / "deploy/batch-1.json")
    generated = OUTPUT.read_text()
    if args.recorded:
        report = json.loads(args.recorded.read_text())
        report["comparison"] = compare(manifest, batch, report["readings"], generated)
        report["replayedOffline"] = True
    else:
        report = capture(manifest, batch, generated)
    if args.batch2:
        report["comparison"] = compare_batch2(manifest, batch, report["readings"], generated, batch2_manifest())
    if args.snapshot:
        with args.snapshot.open("x") as target:
            json.dump(report, target, indent=2)
            target.write("\n")
    print(json.dumps({k: report[k] for k in ("guard", "blockNumber", "blockUtc", "owner", "guardPaused", "comparison")}, indent=2))
    return 0 if report["comparison"]["pass"] else 1


class Tests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(ASSETS.read_text())
        self.batch = load_batch(CONTRACTS / "deploy/batch-1.json")
        expected = {r["symbol"]: r for r in validate_manifest(self.manifest,self.batch)}
        self.readings = []
        for r in self.batch["tokens"]:
            source = expected.get(r["symbol"])
            cfg = {"source": 0, "enabled": False, "maxStepBps": 0, "pauseCheck": 0, "pauseManager": "0x"+"0"*40}
            if source:
                cfg.update(source=1 if r["kind"]=="bstock" else 3, enabled=True,
                           maxStepBps=0 if r["kind"]=="bstock" else 300, pauseCheck=1,
                           pauseManager=self.manifest["bstockPauseManager"].lower() if r["kind"]=="bstock" else "0x"+"0"*40)
            self.readings.append({**r,"config":cfg,"reason":None})

    def check(self, generated=None):
        return compare(self.manifest,self.batch,self.readings,generated if generated is not None else render(self.manifest,self.batch))

    def test_matching_chain_and_file_pass(self):
        self.assertTrue(self.check()["pass"])

    def batch2_check(self):
        return compare_batch2(self.manifest, self.batch, self.readings,
                              render(self.manifest, self.batch), batch2_manifest())

    def test_batch2_is_missing_before_owner_and_matches_after_all_six_are_enabled(self):
        self.assertEqual(self.batch2_check()["missingTokens"], BATCH2_SYMBOLS)
        for row in self.readings:
            if row["symbol"] in BATCH2_SYMBOLS:
                row["config"].update(source=1, enabled=True, pauseCheck=1,
                                      pauseManager=self.manifest["bstockPauseManager"].lower())
        result = self.batch2_check()
        self.assertTrue(result["pass"])
        self.assertEqual(result["expectedEnabledTokens"], 36)
        self.assertEqual(result["expectedTickers"], 23)
        self.assertEqual(result["batch2NotConnectedToProduct"], BATCH2_SYMBOLS)
        self.assertEqual(result["tickersMissingFromGeneratedTarget"], ["FLNC", "MRNA"])
        self.assertEqual(result["tickersMissingFromCombinedManifest"], [])
        self.assertFalse(self.check()["pass"])  # Default first-batch verification is unchanged.

    def test_batch2_detects_bad_config_unknown_enabled_asset_and_missing_reads(self):
        for row in self.readings:
            if row["symbol"] in BATCH2_SYMBOLS:
                row["config"].update(source=1, enabled=True, pauseCheck=1,
                                      pauseManager=self.manifest["bstockPauseManager"].lower())
        next(r for r in self.readings if r["symbol"]=="AMZNB")["config"]["maxStepBps"]=99
        next(r for r in self.readings if r["symbol"]=="NFLXB").update(config=None,reason="unavailable")
        next(r for r in self.readings if r["symbol"]=="SOXLB")["config"].update(source=1,enabled=True)
        result=self.batch2_check()
        self.assertFalse(result["pass"])
        self.assertTrue(result["configurationDifferences"])
        self.assertTrue(result["unavailable"])
        self.assertIn("SOXLB",result["unexpectedEnabledTokens"])

    def test_batch2_rejects_twin_or_control_substitution(self):
        second=batch2_manifest()
        second["assets"][0]["kind"]="ondo"
        with self.assertRaises(ValueError): compare_batch2(self.manifest,self.batch,self.readings,render(self.manifest,self.batch),second)

    def test_disabled_and_unexpected_held_token_detected_in_both_directions(self):
        next(r for r in self.readings if r["symbol"]=="SPCXB")["config"]["enabled"]=False
        next(r for r in self.readings if r["symbol"]=="SOXLB")["config"].update(source=1,enabled=True)
        result=self.check()
        self.assertIn("SPCXB",result["missingTokens"])
        self.assertIn("SOXLB",result["unexpectedEnabledTokens"])
        self.assertIn("SOXL",result["tickersMissingFromGeneratedTarget"])
        self.assertFalse(result["pass"])

    def test_wrong_configuration_missing_read_and_file_drift_fail(self):
        self.readings[0]["config"]["maxStepBps"]=99
        self.readings[1].update(config=None,reason="unavailable")
        result=self.check("export const bad = [];")
        self.assertTrue(result["configurationDifferences"])
        self.assertTrue(result["unavailable"])
        self.assertFalse(result["generatedFileMatchesManifest"])
        self.assertFalse(result["pass"])

    def test_missing_chain_read_cannot_be_silently_omitted(self):
        self.readings.pop()
        with self.assertRaises(ValueError): self.check()

    def test_abi_decoder_refuses_bad_enum_and_boolean(self):
        for words in ([4,1,0,1,0],[1,2,0,1,0],[1,1,0,3,0],[1,1,0,1,2**160]):
            with self.assertRaises(ValueError): asset_config("0x"+"".join(f"{w:064x}" for w in words))

    def test_rpc_refuses_send_and_unapproved_calls_before_network(self):
        from unittest.mock import patch
        with patch("urllib.request.urlopen",side_effect=AssertionError("network forbidden")):
            with self.assertRaises(ValueError): read_rpc("eth_sendRawTransaction",[])
            with self.assertRaises(ValueError): read_rpc("eth_call",[{"to":GUARD,"data":"0xdeadbeef"},"latest"])


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError) as error:
        print(f"comparison unavailable: {type(error).__name__}; no writes to chain",file=sys.stderr)
        raise SystemExit(1) from None
