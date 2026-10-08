"""Generate the planned buyable list from the approved deployment manifest, offline.

The generated list is a deployment target, not proof of on-chain enablement. It is
not imported by the product until the owner has enabled the additions and the
read-only list_enabled.py comparison passes. The explicit --seeds-only command
instead reads public multiplier sources and writes only deploy/seeds.json for
the eight approved Ondo additions; it never writes assets or the product list.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import time
import unittest

from gen_assets import to_wei
from list_candidates import BAPI, E18, decimal, fetch, load_batch

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
ASSETS = CONTRACTS / "deploy/assets.json"
OUTPUT = ROOT / "apps/web/lib/buyable.generated.ts"
REGISTRY = ROOT / "packages/binance/fixtures/raw/rwa_authenticated_probes_20261002T024847Z.json"
APPROVED = ("SPCXB BABAB GOOGLB SKHYB MSTRB CRCLB SNDKB HOODB MSFTB INTCB METAB TSMB "
            "SPCXon GMEon GOOGLon CRCLon AMZNon BMNRon TSMon NFLXon").split()
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")


def registry_names(value):
    names = {}

    def visit(item):
        if isinstance(item, dict):
            ticker, name = item.get("underlyingTicker"), item.get("underlyingName")
            if isinstance(ticker, str) and isinstance(name, str) and name.strip():
                names.setdefault(ticker, name)
            for child in item.values():
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)
    return names


def validate_manifest(manifest, batch):
    rows = manifest.get("assets", [])
    if manifest.get("count") != 20 or [r.get("symbol") for r in rows] != APPROVED:
        raise ValueError("owner manifest must contain exactly the approved 20 additions in batch order")
    known = {r["symbol"]: r for r in batch["tokens"]}
    baseline = manifest.get("existingAssets", [])
    controls = {r["symbol"] for r in batch["tokens"] if r["role"] == "control"}
    if len(baseline) != 10 or {r.get("symbol") for r in baseline} != controls:
        raise ValueError("existing assets must preserve the ten deployed tokens")
    all_rows = rows + baseline
    if len({r.get("address", "").lower() for r in all_rows}) != 30:
        raise ValueError("duplicate manifest address")
    if manifest.get("bstockPauseManager", "").lower() != batch["bstockPauseManager"].lower():
        raise ValueError("shared pause manager differs from recorded Batch 1")
    for row in all_rows:
        source = known.get(row["symbol"])
        if (source is None or source["held"] or not ADDRESS.fullmatch(row["address"])
                or row["address"].lower() != source["address"].lower()
                or any(row[k] != source[k] for k in ("ticker", "kind"))):
            raise ValueError("manifest identity differs from fixed Batch 1")
        if not isinstance(row.get("name"), str) or not row["name"].strip():
            raise ValueError("registry company name unavailable")
    return all_rows


def prepare_manifest(original, batch, selection, names, capture_root=ROOT):
    selected = {r["token"]: r for r in selection["tokens"]}
    known = {r["symbol"]: r for r in batch["tokens"]}
    additions = []
    for symbol in APPROVED:
        result, token = selected[symbol], known[symbol]
        if (result["fork"] != "passed" or result["depth"] != "passed"
                or result["held"] or result["role"] != "candidate"):
            raise ValueError("approved token lacks passing non-held candidate evidence")
        if hashlib.sha256((capture_root / result["canonicalCapture"]).read_bytes()).hexdigest() != result["sha256"]:
            raise ValueError("passing capture hash differs from selection report")
        additions.append({k: token[k] for k in ("symbol", "ticker", "address", "kind")})
    baseline = original.get("existingAssets", original["assets"])
    manifest = {k: original[k] for k in ("router", "approveTarget", "bstockPauseManager")}
    manifest.update(count=20, assets=additions, existingAssets=[dict(r) for r in baseline],
                    scope="batch-1-new-passing-20", nameSource=str(REGISTRY.relative_to(ROOT)))
    for row in manifest["assets"] + manifest["existingAssets"]:
        if row["ticker"] not in names:
            raise ValueError("registry company name unavailable")
        row["name"] = names[row["ticker"]]
    validate_manifest(manifest, batch)
    return manifest


def render(manifest, batch):
    all_rows = validate_manifest(manifest, batch)
    names = {}
    for row in all_rows:
        previous = names.setdefault(row["ticker"], row["name"])
        if previous != row["name"]:
            raise ValueError("issuers disagree on registry company name")
    tickers = [{"ticker": tk, "name": names[tk]} for tk in sorted(names)]
    assets = [{k: r[k] for k in ("symbol", "ticker", "address", "kind")} for r in all_rows]
    def array(items):
        return "[\n" + "".join("  {\n" + "".join(
            f"    {key}: {json.dumps(value, ensure_ascii=False)},\n" for key, value in row.items())
            + "  },\n" for row in items) + "]"

    return ("// Generated by contracts/tools/gen_buyable.py from contracts/deploy/assets.json.\n"
            "// Planned target: import into the product only after list_enabled.py passes.\n"
            "export const GENERATED_BUYABLE_TICKERS = " + array(tickers)
            + " as const;\n\nexport const GENERATED_BUYABLE_ASSETS = "
            + array(assets) + " as const;\n")


def seed_multiplier(raw):
    value = decimal(raw)
    if value < decimal("0.000000000000000001") or value >= decimal(2**256):
        raise ValueError("positive uint256 multiplier required")
    # Same positive-decimal conversion as gen_assets.py; no float share maths.
    multiplier = to_wei(format(value, "f"))
    if multiplier >= 2**256:
        raise ValueError("positive uint256 multiplier required")
    return multiplier


def seed_payload(manifest, batch, public_read, fetched_at):
    validate_manifest(manifest, batch)
    tokens = [r for r in manifest["assets"] if r["kind"] == "ondo"]
    if [r["symbol"] for r in tokens] != APPROVED[12:]:
        raise ValueError("exactly the eight approved Ondo symbols required")
    rows = public_read(BAPI + "/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai?type=1")
    if not isinstance(rows, list):
        raise ValueError("public Ondo list unavailable")
    seeds = {}
    for token in tokens:
        matches = [r for r in rows if isinstance(r, dict) and str(r.get("chainId")) == "56"
                   and str(r.get("contractAddress", "")).lower() == token["address"].lower()]
        if len(matches) != 1:
            raise ValueError(f"{token['symbol']}: exactly one matching public BSC token required")
        row = matches[0]
        if row.get("symbol") != token["symbol"] or row.get("ticker") != token["ticker"] or row.get("type") != 1:
            raise ValueError(f"{token['symbol']}: public registry identity differs from manifest")
        try:
            dynamic = public_read(BAPI + "/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai"
                                  + f"?chainId=56&contractAddress={token['address']}")
        except (ValueError, OSError):
            raise ValueError(f"{token['symbol']}: public dynamic multiplier source unavailable") from None
        if (not isinstance(dynamic, dict) or dynamic.get("symbol") != token["symbol"]
                or dynamic.get("ticker") != token["ticker"] or not isinstance(dynamic.get("tokenInfo"), dict)):
            raise ValueError(f"{token['symbol']}: public dynamic identity or multiplier unavailable")
        m_list, m_dyn = row.get("multiplier"), dynamic["tokenInfo"].get("sharesMultiplier")
        try:
            a, b = seed_multiplier(m_dyn), seed_multiplier(m_list)
        except ValueError:
            raise ValueError(f"{token['symbol']}: positive uint256 readings required from both multiplier sources") from None
        if abs(a - b) * 1000 > min(a, b):
            raise ValueError(f"{token['symbol']}: multiplier sources disagree by more than 0.1%")
        seeds[token["symbol"]] = {"multiplier": str(a), "list": str(m_list), "dynamic": str(m_dyn)}
    return {"fetchedAtUnix": fetched_at, "fetchedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(fetched_at)),
            "seeds": seeds}


def write_seeds_only(assets_path, batch, public_read=None, clock=None):
    original = assets_path.read_bytes()
    # Timestamp the start of recording so slow requests cannot extend seed age.
    payload = seed_payload(json.loads(original), batch, public_read or fetch, int((clock or time.time)()))
    if assets_path.read_bytes() != original:
        raise ValueError("manifest changed during seed recording; no seeds written")
    target = assets_path.with_name("seeds.json")
    temporary = None
    try:
        # Validate all eight before touching the old file; atomically replace it.
        with tempfile.NamedTemporaryFile(mode="w", dir=target.parent, prefix=".seeds-", suffix=".tmp", delete=False) as out:
            temporary = Path(out.name)
            out.write(json.dumps(payload, indent=2) + "\n")
        temporary.replace(target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return payload


def main():
    p = argparse.ArgumentParser(description=__doc__)
    modes = p.add_mutually_exclusive_group()
    modes.add_argument("--prepare-assets", action="store_true")
    modes.add_argument("--check", action="store_true")
    modes.add_argument("--seeds-only", action="store_true", help="public two-source recording for exactly the eight manifest Ondo additions; write only seeds.json")
    modes.add_argument("--self-test", action="store_true")
    args = p.parse_args()
    if args.self_test:
        return 0 if unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests)).wasSuccessful() else 1
    batch = load_batch(CONTRACTS / "deploy/batch-1.json")
    if args.seeds_only:
        payload = write_seeds_only(ASSETS, batch)
        print("wrote deploy/seeds.json for exactly: " + ", ".join(payload["seeds"]))
        print("multiplier sources agree within 0.1%; assets.json and generated product list unchanged")
        return 0
    manifest = json.loads(ASSETS.read_text())
    if args.prepare_assets:
        manifest = prepare_manifest(manifest, batch,
            json.loads((CONTRACTS / "captures/depth/batch-1-fork-selection.json").read_text()),
            registry_names(json.loads(REGISTRY.read_text())))
    rendered = render(manifest, batch)
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text() != rendered:
            raise ValueError("generated buyable file differs; run gen_buyable.py and format the file")
    else:
        if args.prepare_assets:
            ASSETS.write_text(json.dumps(manifest, indent=2) + "\n")
        OUTPUT.write_text(rendered)
    print("20 owner additions; 10 existing tokens retained in comparison; 21 planned tickers; product list unchanged")
    return 0


class Tests(unittest.TestCase):
    def setUp(self):
        import copy
        self.copy = copy.deepcopy
        self.batch = load_batch(CONTRACTS / "deploy/batch-1.json")
        self.manifest = json.loads(ASSETS.read_text())

    def test_exact_twenty_additions_and_existing_tickers_retained(self):
        self.assertEqual(len(validate_manifest(self.manifest, self.batch)), 30)
        rendered = render(self.manifest, self.batch)
        self.assertIn('ticker: "NVDA"', rendered)
        self.assertIn('ticker: "GME"', rendered)
        self.assertNotIn('ticker: "SOXL"', rendered)

    def test_held_control_address_and_kind_substitutions_rejected(self):
        for key, value in (("symbol", "SOXLB"), ("symbol", "NVDAB"), ("kind", "ondo"),
                           ("address", "0x" + "1" * 40), ("name", "")):
            candidate = self.copy(self.manifest)
            candidate["assets"][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                render(candidate, self.batch)

    def test_missing_existing_token_and_conflicting_name_rejected(self):
        candidate = self.copy(self.manifest)
        candidate["existingAssets"].pop()
        with self.assertRaises(ValueError):
            render(candidate, self.batch)
        candidate = self.copy(self.manifest)
        candidate["assets"][12]["name"] = "wrong company"
        with self.assertRaises(ValueError):
            render(candidate, self.batch)

    def test_recorded_names_are_not_invented(self):
        names = registry_names(json.loads(REGISTRY.read_text()))
        for row in self.manifest["assets"]:
            self.assertEqual(row["name"], names[row["ticker"]])

    def test_failed_evidence_refuses_preparation(self):
        selection = json.loads((CONTRACTS / "captures/depth/batch-1-fork-selection.json").read_text())
        row = next(r for r in selection["tokens"] if r["token"] == APPROVED[0])
        row["fork"] = "failed"
        with self.assertRaisesRegex(ValueError, "passing"):
            prepare_manifest(self.manifest, self.batch, selection, {})

    def public_seed_data(self):
        # Include controls and held tokens in the public list: none may be seeded.
        tokens = [r for r in self.batch["tokens"] if r["kind"] == "ondo"]
        rows = [{"chainId": "56", "contractAddress": r["address"], "symbol": r["symbol"],
                 "ticker": r["ticker"], "type": 1, "multiplier": "1.2345678901234567899"} for r in tokens]
        dynamic = {r["address"]: {"symbol": r["symbol"], "ticker": r["ticker"],
                   "tokenInfo": {"sharesMultiplier": "1.2345678901234567899"}} for r in tokens}
        calls = []

        def read(url):
            calls.append(url)
            return rows if "list/ai?" in url else dynamic[url.split("contractAddress=")[1]]

        return rows, dynamic, calls, read

    def test_seeds_only_cli_writes_exact_eight_and_preserves_assets_and_product_file(self):
        import contextlib
        import io
        from unittest.mock import patch
        _, _, calls, read = self.public_seed_data()
        with tempfile.TemporaryDirectory() as directory:
            assets = Path(directory) / "assets.json"
            output = Path(directory) / "buyable.generated.ts"
            assets.write_bytes(ASSETS.read_bytes())
            output.write_text("existing product file")
            before = assets.read_bytes(), assets.stat().st_mtime_ns, output.read_bytes()
            with patch(__name__ + ".ASSETS", assets), patch(__name__ + ".OUTPUT", output), \
                    patch(__name__ + ".fetch", side_effect=read), patch("time.time", return_value=1791441300), \
                    patch("sys.argv", ["gen_buyable.py", "--seeds-only"]), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(), 0)
            payload = json.loads(assets.with_name("seeds.json").read_text())
            self.assertEqual(list(payload["seeds"]), APPROVED[12:])
            self.assertEqual(payload["fetchedAtUnix"], 1791441300)
            self.assertEqual(payload["fetchedAtUtc"], "2026-10-08T06:35:00Z")
            self.assertEqual(before, (assets.read_bytes(), assets.stat().st_mtime_ns, output.read_bytes()))
            self.assertEqual(len(calls), 9)
            self.assertEqual([u.split("contractAddress=")[1] for u in calls[1:]],
                             [r["address"] for r in self.manifest["assets"] if r["kind"] == "ondo"])
            for seed in payload["seeds"].values():
                self.assertEqual(seed, {"multiplier": "1234567890123456789", "list": "1.2345678901234567899", "dynamic": "1.2345678901234567899"})
            self.assertFalse(list(assets.parent.glob(".seeds-*.tmp")))

    def test_seed_cross_check_uses_same_boundary_and_fixed_point_as_gen_assets(self):
        rows, dynamic, _, read = self.public_seed_data()
        token = self.manifest["assets"][12]
        row = next(r for r in rows if r["symbol"] == token["symbol"])
        row["multiplier"] = "1"
        dynamic[token["address"]]["tokenInfo"]["sharesMultiplier"] = "1.001"
        self.assertEqual(seed_payload(self.manifest, self.batch, read, 1)["seeds"][token["symbol"]]["multiplier"], str(to_wei("1.001")))
        dynamic[token["address"]]["tokenInfo"]["sharesMultiplier"] = "1.001000000000000001"
        with self.assertRaisesRegex(ValueError, "more than 0.1%"):
            seed_payload(self.manifest, self.batch, read, 1)
        for value in ("1", "10.01234567890123456789", "0.000000000000000001"):
            self.assertEqual(seed_multiplier(value), to_wei(value))
        maximum = 2**256 - 1
        self.assertEqual(seed_multiplier(f"{maximum // E18}.{maximum % E18:018d}"), maximum)
        with self.assertRaises(ValueError):
            seed_multiplier(f"{(maximum + 1) // E18}.{(maximum + 1) % E18:018d}")
        for value in (None, True, "0", "-1", "NaN", "Infinity", "0.0000000000000000001", str(2**256)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                seed_multiplier(value)

    def test_last_token_failure_preserves_old_seeds_and_assets(self):
        token = self.manifest["assets"][-1]
        for failure in ("missing", "disagree", "identity", "transport"):
            rows, dynamic, _, read = self.public_seed_data()
            if failure == "missing":
                dynamic[token["address"]]["tokenInfo"]["sharesMultiplier"] = None
            elif failure == "disagree":
                dynamic[token["address"]]["tokenInfo"]["sharesMultiplier"] = "10"
            elif failure == "identity":
                dynamic[token["address"]]["symbol"] = "WRONG"
            def source(url):
                if failure == "transport" and url.endswith(token["address"]):
                    raise ValueError("public data unavailable")
                return read(url)
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                assets = Path(directory) / "assets.json"
                seeds = assets.with_name("seeds.json")
                assets.write_bytes(ASSETS.read_bytes())
                seeds.write_text("previous seeds")
                before = assets.read_bytes(), seeds.read_bytes()
                with self.assertRaises(ValueError):
                    write_seeds_only(assets, self.batch, source, lambda: 1)
                self.assertEqual(before, (assets.read_bytes(), seeds.read_bytes()))
                self.assertFalse(list(assets.parent.glob(".seeds-*.tmp")))

    def test_seed_registry_identity_and_duplicate_matches_refused(self):
        for failure in ("missing", "duplicate", "ticker", "kind", "chain"):
            rows, _, _, read = self.public_seed_data()
            index = next(i for i,r in enumerate(rows) if r["symbol"] == APPROVED[12])
            if failure == "missing": rows.pop(index)
            elif failure == "duplicate": rows.append(dict(rows[index]))
            elif failure == "ticker": rows[index]["ticker"] = "WRONG"
            elif failure == "kind": rows[index]["type"] = 3
            else: rows[index]["chainId"] = "1"
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                seed_payload(self.manifest, self.batch, read, 1)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError) as error:
        reason = str(error) if isinstance(error, ValueError) else type(error).__name__
        print(f"generation refused: {reason}; no seeds or product import changed", file=sys.stderr)
        raise SystemExit(1) from None
