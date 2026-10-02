"""Record the raw region-block response (40304) as an M1 fixture.

WHY NOT THE SEOUL BOX: Seoul is allowed, so it never sees the block. And a request with no or a bad key
is answered 40101 before any region check, so the block can only be captured with a VALID key sent from a
blocked caller IP (F3: a US VPN exit gave 40304 as HTTP 200 on every call, even supported/chain).

RUN IT ON YOUR OWN LAPTOP with a system-wide VPN exit in the United States (a browser-only VPN or a proxy
that the script does not use will not work). Your key stays on your machine: it is read from the environment
or a hidden prompt, used only to sign the request, and never written to the output file.

    git pull && python3 spike/record_region_block.py

Makes ONE request (the API rate limit is about 5 calls/s) and writes
packages/binance/fixtures/raw/region_block_<country>_<stamp>.json. Commit and push that file.
Use a US exit first; Canada, UK, Japan, Netherlands exits are also worth one run each (F9 lists them as untested).
"""
import datetime as dt
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import w3api  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "binance", "fixtures", "raw")


def egress_country():
    """Where the world sees you. Best effort; the file records it so we know which exit produced the body."""
    try:
        req = urllib.request.Request("https://ipinfo.io/country", headers={"User-Agent": "curl/8"})
        return urllib.request.urlopen(req, timeout=10).read().decode().strip()
    except Exception as e:  # noqa: BLE001
        return f"unknown ({e!r})"


def main():
    country = egress_country()
    print("your egress country:", country)
    if country == "KR":
        print("This is a Korean exit, which is allowed: you will not get a block. Switch the VPN and rerun.")
        return
    client = w3api.Client()
    try:
        client.get("/api/v1/dex/aggregator/supported/chain", {"binanceChainId": "56"})
        res = {"ok": True, "note": "request succeeded: this exit is NOT blocked"}
    except w3api.ApiError as e:
        res = {"ok": False, **e.res}
    except Exception as e:  # noqa: BLE001
        res = {"ok": False, "exception": repr(e)}
    record = {
        "path": "/api/v1/dex/aggregator/supported/chain",
        "params": {"binanceChainId": "56"},
        "egress_country": country,
        "recorded_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        **res,
    }
    os.makedirs(OUT, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.join(OUT, f"region_block_{country}_{stamp}.json")
    with open(path, "w") as f:
        json.dump(record, f, indent=1)
    print(json.dumps({k: record[k] for k in record if k not in ("params",)}, indent=1)[:900])
    print("saved", os.path.relpath(path))


if __name__ == "__main__":
    main()
