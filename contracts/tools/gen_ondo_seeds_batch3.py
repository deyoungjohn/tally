"""Record owner seeds for the four Ondo tokens of ShareGuard Batch 3 (INTCon, METAon, MSFTon, MSTRon).

Public Binance readings only, no credentials and no chain writes. Each multiplier is read from two public
sources and must agree within 0.1%; one failure writes nothing. The file is valid for two hours (the contract
refuses an older one), so run it right before AddOndoBatch3.

    python3 tools/gen_ondo_seeds_batch3.py            # writes deploy/seeds-batch3.json
"""

import json
from pathlib import Path
import sys
import time

from gen_buyable import seed_multiplier
from list_candidates import BAPI, fetch

CONTRACTS = Path(__file__).resolve().parents[1]
BATCH1 = CONTRACTS / "deploy/batch-1.json"
OUT = CONTRACTS / "deploy/seeds-batch3.json"
SYMBOLS = ["INTCon", "METAon", "MSFTon", "MSTRon"]


def record(public_read=fetch, clock=time.time):
    fetched_at = int(clock())
    batch = json.loads(BATCH1.read_text())
    tokens = [t for s in SYMBOLS for t in batch["tokens"] if t["symbol"] == s]
    if [t["symbol"] for t in tokens] != SYMBOLS or any(t["kind"] != "ondo" or t["held"] for t in tokens):
        raise ValueError("Batch 1 identity differs from the four Ondo additions")
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
            raise ValueError(f"{token['symbol']}: public registry identity differs from the manifest")
        dynamic = public_read(BAPI + "/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai"
                              + f"?chainId=56&contractAddress={token['address']}")
        if (not isinstance(dynamic, dict) or dynamic.get("symbol") != token["symbol"]
                or not isinstance(dynamic.get("tokenInfo"), dict)):
            raise ValueError(f"{token['symbol']}: public dynamic multiplier unavailable")
        m_list, m_dyn = row.get("multiplier"), dynamic["tokenInfo"].get("sharesMultiplier")
        a, b = seed_multiplier(m_dyn), seed_multiplier(m_list)
        if abs(a - b) * 1000 > min(a, b):
            raise ValueError(f"{token['symbol']}: multiplier sources disagree by more than 0.1%")
        seeds[token["symbol"]] = {"multiplier": str(a), "list": str(m_list), "dynamic": str(m_dyn)}
    return {"fetchedAtUnix": fetched_at,
            "fetchedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(fetched_at)), "seeds": seeds}


if __name__ == "__main__":
    try:
        payload = record()
    except ValueError as e:
        print(f"refused: {e}; nothing written", file=sys.stderr)
        sys.exit(1)
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print("wrote deploy/seeds-batch3.json for " + ", ".join(payload["seeds"]))
