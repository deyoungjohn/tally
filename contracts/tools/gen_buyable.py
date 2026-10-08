"""Generate the planned buyable list from the approved deployment manifest, offline.

The generated list is a deployment target, not proof of on-chain enablement. It is
not imported by the product until the owner has enabled the additions and the
read-only list_enabled.py comparison passes. Never writes or fetches seeds.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import unittest

from list_candidates import load_batch

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


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--prepare-assets", action="store_true")
    p.add_argument("--check", action="store_true")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args()
    if args.self_test:
        return 0 if unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests)).wasSuccessful() else 1
    batch = load_batch(CONTRACTS / "deploy/batch-1.json")
    manifest = json.loads(ASSETS.read_text())
    if args.prepare_assets:
        if args.check:
            raise ValueError("--prepare-assets cannot be combined with --check")
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


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError) as error:
        print(f"generation refused: {type(error).__name__}; no seeds or product import changed", file=sys.stderr)
        raise SystemExit(1) from None
