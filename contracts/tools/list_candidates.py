"""Report ShareGuard expansion candidates using public Binance data and chain reads.

No credentials, RPC configuration, quotes, transactions, or secrets are read here.
The discovery report is a shortlist, not proof that an asset can execute. The
fixed Batch 1 mode additionally checks facts through the authorized keyless public
chain transport. Authenticated depth captures remain the chief engineer's work.
Without verified multiplier/pause readings, an asset cannot enter assets.json.

    python3 tools/list_candidates.py --report /tmp/shareguard-candidates.json
    python3 tools/list_candidates.py --self-test

Chain readings JSON (provided by the chief engineer):
    {"chainId": 56, "observedAtUnix": 1791374400, "tokens": {
      "0x...": {"uiMultiplierE18": "1000000000000000000",
                "pauseManager": "0x...", "paused": false}}}
For Ondo the multiplier comes from the two public API readings; pauseManager must
be the manager read from that token. An optional quoteRefusedReason excludes it.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
import hashlib
import json
from pathlib import Path
import re
import time
import threading
import unittest
import urllib.error
import urllib.request


BAPI = "https://www.binance.com/bapi/defi"
WEB3 = "https://web3.binance.com/bapi/defi"
HEADERS = {"Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)"}
DEPLOY = Path(__file__).resolve().parent.parent / "deploy"
KINDS = {1: "ondo", 2: "xstocks", 3: "bstock"}
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")
E18 = 10**18
DAY = 86400
GECKO = "https://api.geckoterminal.com/api/v2"
# Match counterpart contracts, never a symbol which an unrelated token can copy.
STABLE_COUNTERPARTS = {
    "0x55d398326f99059ff775485246999027b3197955": "USDT",
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "USDC",
    "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409": "FDUSD",
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": "BNB",
    "0x0000000000000000000000000000000000000000": "BNB",
}


class HistoryCache:
    """Public-only responses, fixed UTC cutoff, rate limiting and resumable disk cache."""

    def __init__(self, path):
        self.path = path
        self.data = json.loads(path.read_text()) if path.exists() else {
            "schema": 1, "asOfUnix": int(time.time()), "responses": {}}
        if self.data.get("schema") != 1:
            raise ValueError("unsupported history cache schema")
        self.cutoff = self.data["asOfUnix"] // DAY * DAY
        self.lock = threading.Lock()
        self.last_request = {}

    def get(self, url, text=False):
        digest = hashlib.sha256(url.encode()).hexdigest()
        with self.lock:
            cached = self.data["responses"].get(digest)
            if cached is not None:
                return cached["payload"]
        source = "gecko" if url.startswith(GECKO) else "binance" if url.startswith(BAPI) else "nasdaq"
        # The public specification now warns that the free quota can be ~10/min.
        # The orchestrator saw 30/min; use the lower rate and resume cached work.
        interval = 6.2 if source == "gecko" else 0.35
        for attempt in range(4):
            with self.lock:
                delay = max(0, self.last_request.get(source, 0) + interval - time.monotonic())
                self.last_request[source] = time.monotonic() + delay
            if delay:
                time.sleep(delay)
            try:
                headers = HEADERS if text else {**HEADERS, "Accept": "application/json;version=20230203"}
                request = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(request, timeout=25) as response:
                    raw = response.read().decode()
                payload = raw if text else json.loads(raw, parse_float=Decimal)
                if not text and source == "binance" and payload.get("code") != "000000":
                    raise ValueError(f"public endpoint refused: code {payload.get('code')}")
                if not text and payload.get("errors"):
                    raise ValueError("public endpoint returned errors")
                # Store numeric JSON readings as decimal strings, with no float round trip.
                payload = json.loads(json.dumps(payload, default=str)) if not text else payload
                with self.lock:
                    self.data["responses"][digest] = {"url": url, "fetchedAtUnix": int(time.time()), "payload": payload}
                    temporary = self.path.with_suffix(".tmp")
                    temporary.write_text(json.dumps(self.data, default=str))
                    temporary.replace(self.path)
                return payload
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                if isinstance(exc, urllib.error.HTTPError) and exc.code in (400, 404):
                    raise ValueError(f"public history unavailable (HTTP {exc.code})") from None
                if attempt == 3:
                    detail = f"HTTP {exc.code}" if isinstance(exc, urllib.error.HTTPError) else type(exc).__name__
                    raise ValueError(f"public history unavailable ({detail})") from None
                # Back off on rate limits; retries preserve all completed cache entries.
                time.sleep(60 if isinstance(exc, urllib.error.HTTPError) and exc.code == 429 else min(10 * (attempt + 1), 30))


def median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def window_metrics(days, cutoff):
    out = {}
    for size in (7, 30, 90):
        values = [days.get(cutoff - DAY * i) for i in range(1, size + 1)]
        available = [v for v in values if v is not None]
        complete = len(available) == size
        out[str(size)] = {
            "complete": complete, "coveredDays": len(available), "windowDays": size,
            "medianDailyUsd": str(median(available)) if complete else None,
            "daysAtLeast1000": sum(v >= 1000 for v in available),
            "shareDaysAtLeast1000Pct": str(Decimal(sum(v >= 1000 for v in available)) * 100 / size) if complete else None,
            "observedMedianUsd": str(median(available)) if available else None}
    return out


def daily_candles(candles, cutoff, milliseconds=False):
    days = {}
    for candle in candles:
        if not isinstance(candle, list) or len(candle) < 6:
            raise ValueError("malformed daily candle")
        timestamp = int(candle[0]) // (1000 if milliseconds else 1)
        if timestamp % DAY:
            raise ValueError("daily candle does not begin at UTC midnight")
        if timestamp >= cutoff:
            continue  # Never count the current partial day.
        if milliseconds and len(candle) >= 7 and int(candle[6]) > cutoff * 1000:
            continue
        volume = decimal(candle[5])
        if timestamp in days and days[timestamp] != volume:
            raise ValueError("conflicting duplicate daily candle")
        days[timestamp] = volume
    return days


def recorded_calendar(days, cutoff):
    """No reported activity in chart gaps is zero; never fabricate pre-history data.

    Called only after a successful chart response. A failed request stays missing.
    This is reported USD volume, not a claim to reconstruct every historical trade.
    """
    if not days:
        return {}, 0
    out = dict(days)
    omitted = 0
    for day in range(min(days), cutoff, DAY):
        if day not in out:
            out[day] = Decimal(0)
            omitted += 1
    return out, omitted


def listing_directory(cache):
    entries = {}
    sources = []
    for filename in ("nasdaqlisted.txt", "otherlisted.txt"):
        url = f"https://www.nasdaqtrader.com/dynamic/SymDir/{filename}"
        raw = cache.get(url, text=True)
        sources.append({"url": url, "fileCreationTime": next((line for line in raw.splitlines() if line.startswith("File Creation Time")), None)})
        for row in csv.DictReader(raw.splitlines(), delimiter="|"):
            symbol = row.get("Symbol") or row.get("ACT Symbol")
            name = row.get("Security Name", "")
            if row.get("Test Issue") != "N" or not symbol:
                continue
            # A symbol match is insufficient if the instrument is a warrant/unit/right.
            is_stock = any(term in name.lower() for term in ("common stock", "common share", "ordinary share", "subordinate voting share", "depositary share", "depository share", "depositary receipt", "registry share", "preferred stock", "capital stock", "shares of beneficial interest"))
            if re.search(r"\b(warrants?|rights?|units?)\b", name, re.IGNORECASE):
                is_stock = False
            is_etf = row.get("ETF") == "Y"
            evidence = None
            if symbol == "TSM" and name == "Taiwan Semiconductor Manufacturing Company Ltd.":
                # This directory row omits the instrument type. Verify the ADS
                # through the issuer, rather than classify every unknown row as stock.
                evidence = "https://investor.tsmc.com/english/fundamentals"
                try:
                    issuer = cache.get(evidence, text=True)
                    is_stock = all(term in issuer for term in ("American Depositary Shares", "New York Stock Exchange", "TSM"))
                    sources.append({"url": evidence, "confirmed": is_stock})
                except ValueError:
                    sources.append({"url": evidence, "error": "issuer listing evidence unavailable"})
            if not is_stock and not is_etf:
                continue
            entries[symbol] = {"kind": "ETF" if is_etf else "stock", "name": name, "source": url}
            if evidence:
                entries[symbol]["instrumentEvidence"] = evidence
    return entries, sources


def pool_counterpart(pool, token_address):
    related = pool["relationships"]
    a = related["base_token"]["data"]["id"].removeprefix("bsc_").lower()
    b = related["quote_token"]["data"]["id"].removeprefix("bsc_").lower()
    if a == token_address:
        return b
    if b == token_address:
        return a
    raise ValueError("pool does not contain requested token")


def pool_rows(cache, address):
    pools = {}
    incomplete = False
    for page in range(1, 11):
        try:
            response = cache.get(f"{GECKO}/networks/bsc/tokens/{address}/pools?include=base_token,quote_token&page={page}")
        except ValueError:
            if not pools:
                raise
            incomplete = True
            break
        rows = response["data"]
        for row in rows:
            pools[row["id"]] = row
        if len(rows) < 20:
            break
        if page == 10:
            incomplete = True
    return list(pools.values()), incomplete


def pool_metric_total(group, key):
    """Keep a missing reading distinct from zero; sum the known lower bound."""
    known = [decimal(pool[key]) for pool in group if pool[key] is not None]
    return str(sum(known, Decimal(0))), len(known) != len(group)


def inspect_history(row, cache, listings, configured):
    result = {key: row[key] for key in ("symbol", "ticker", "address", "kind")}
    result.update({"alreadyInManifest": row["address"] in configured,
                   "usListed": listings.get(row["ticker"]), "reasons": [], "notes": [],
                   "ageDays": None, "ageIsLowerBound": False, "bestStablePoolTvlUsd": None,
                   "stablePairVolumeUsd24h": None, "stockPairVolumeUsd24h": None,
                   "stablePairTvlUsd": None, "stockPairTvlUsd": None, "pools": []})
    if not result["usListed"]:
        result["reasons"].append("US-listed stock/ETF not confirmed")
    cutoff = cache.cutoff
    days = {}
    try:
        if row["kind"] == "bstock":
            url = f"{BAPI}/v1/public/wallet-direct/buw/wallet/dex/market/token/kline/ai?chainId=56&contractAddress={row['address']}&interval=1d&limit=95"
            candles = cache.get(url)["data"]["klineInfos"]
            days, omitted = recorded_calendar(daily_candles(candles, cutoff, milliseconds=True), cutoff)
            if omitted:
                result["notes"].append(f"{omitted} calendar days omitted by successful K-Line reply: no reported volume, counted as $0")
            if days:
                result["ageDays"] = (cutoff - min(days)) // DAY
                result["ageIsLowerBound"] = len(candles) >= 95
            result["source"] = "Binance token K-Line; observed history age"
        else:
            pools, capped = pool_rows(cache, row["address"])
            if capped:
                result["reasons"].append("pool discovery incomplete: pagination capped or unavailable")
            stable = []
            stock_pairs = []
            other_pairs = []
            # The old public registry report includes excluded assets too, allowing
            # exact identification of stock-to-stock pools without symbol guessing.
            for pool in pools:
                counterpart = pool_counterpart(pool, row["address"])
                attrs = pool["attributes"]
                summary = {"address": attrs["address"], "name": attrs["name"],
                           "counterpartAddress": counterpart, "volumeUsd24h": attrs["volume_usd"]["h24"],
                           "tvlUsd": attrs["reserve_in_usd"], "createdAt": attrs["pool_created_at"]}
                if counterpart in STABLE_COUNTERPARTS:
                    summary["counterpart"] = STABLE_COUNTERPARTS[counterpart]
                    stable.append(summary)
                elif counterpart in cache.registry_addresses:
                    stock_pairs.append(summary)
                else:
                    other_pairs.append(summary)
            result["pools"] = {"stablePairs": stable, "stockPairs": stock_pairs, "otherPairs": other_pairs}
            if any(p["tvlUsd"] is not None and decimal(p["tvlUsd"]) >= Decimal("1e30") for p in stable):
                # A data-quality warning, not the chief engineer's volume cutoff.
                # Keep the raw reading in the report instead of silently replacing it.
                result["reasons"].append("implausible reported pool TVL (>=1e30 USD); unverified")
            for prefix, group in (("stablePair", stable), ("stockPair", stock_pairs)):
                for metric, field in (("volumeUsd24h", "VolumeUsd24h"), ("tvlUsd", "TvlUsd")):
                    total, incomplete = pool_metric_total(group, metric)
                    result[prefix + field] = total
                    result[prefix + field + "Incomplete"] = incomplete
                    if incomplete:
                        result["notes"].append(f"{prefix} {metric}: null readings; sum is a lower bound")
            known_tvl = [p for p in stable if p["tvlUsd"] is not None]
            if known_tvl:
                best = max(known_tvl, key=lambda p: (decimal(p["tvlUsd"]), decimal(p["volumeUsd24h"]) if p["volumeUsd24h"] is not None else Decimal(-1), p["address"]))
                result["bestStablePoolTvlUsd"] = best["tvlUsd"]
                result["bestStablePool"] = best["address"]
                created = [int(datetime.fromisoformat(p["createdAt"].replace("Z", "+00:00")).timestamp()) for p in stable]
                earliest = min(created) // DAY * DAY
                result["ageDays"] = max(0, (cutoff - earliest) // DAY)
                result["ageIsLowerBound"] = True
                result["source"] = "GeckoTerminal highest-TVL eligible pool history; oldest eligible pool age"
                result["historySelection"] = "Highest current TVL; ties use current 24h volume, then address"
                result["notes"].append("Historical columns use the best stable-pair pool, not the sum of pool histories. Snapshot volume/TVL totals include all discovered pools in each group.")
                # The table pairs sustained venue volume with that venue's TVL.
                # Do not add stock-to-stock pools or unavailable tiny-pool history
                # to this series. All discovered pool snapshot totals stay visible.
                for pool, created_at in [(best, created[stable.index(best)])]:
                    try:
                        url = f"{GECKO}/networks/bsc/pools/{pool['address']}/ohlcv/day?limit=90&currency=usd&include_empty_intervals=true&before_timestamp={cutoff - 1}"
                        candles = cache.get(url)["data"]["attributes"]["ohlcv_list"]
                        history, omitted = recorded_calendar(daily_candles(candles, cutoff), cutoff)
                        pool["omittedDaysCountedAsNoReportedVolume"] = omitted
                        days = history
                        pool["historyDaysReturned"] = len(history)
                    except ValueError as exc:
                        pool["historyError"] = str(exc)
                        result["reasons"].append(f"stable-pool history unavailable: {pool['address']}")
            elif not stable:
                result["reasons"].append("no USDT/USDC/FDUSD/BNB pool found")
                result["source"] = "GeckoTerminal pool discovery"
            else:
                result["reasons"].append("eligible pools have no reported TVL; best pool unknown")
                result["source"] = "GeckoTerminal pool discovery"
            result["notes"].append("Listed eligible pools only; historical removed pools are not reconstructed")
    except (ValueError, KeyError, TypeError) as exc:
        result["reasons"].append(f"history unavailable ({type(exc).__name__})")
    result["windows"] = window_metrics(days, cutoff)
    for size, window in result["windows"].items():
        if not window["complete"]:
            result["notes"].append(f"incomplete {size}d history: {window['coveredDays']}/{size} days")
    return result


def render_history(report):
    lines = ["| Token | Age d | Median $/day 7 / 30 / 90 | Days ≥$1k % 7 / 30 / 90 | Best stable-pool TVL $ | Stable-pair 24h volume / TVL $ | Stock-pair 24h volume / TVL $ | US stock/ETF | Status |",
             "|---|---:|---:|---:|---:|---:|---:|---|---|"]
    def money(value):
        if value is None:
            return "—"
        number = decimal(value)
        return "<1" if 0 < number < 1 else f"{number:.2E}" if number >= Decimal("1e12") else f"{number:,.0f}"
    for row in report["tokens"]:
        age = "—" if row["ageDays"] is None else ("≥" if row["ageIsLowerBound"] else "") + str(row["ageDays"])
        medians = " / ".join(money(row["windows"][str(n)]["medianDailyUsd"]) for n in (7, 30, 90))
        shares = " / ".join("—" if row["windows"][str(n)]["shareDaysAtLeast1000Pct"] is None else f"{decimal(row['windows'][str(n)]['shareDaysAtLeast1000Pct']):.0f}" for n in (7, 30, 90))
        listing = "unconfirmed" if row["usListed"] is None else "Yes: " + row["usListed"]["kind"]
        reasons = list(row["reasons"])
        if row["alreadyInManifest"]:
            reasons.insert(0, "existing")
        coverage = [n for n in (7, 30, 90) if not row["windows"][str(n)]["complete"]]
        if coverage:
            reasons.append("short/missing " + "/".join(map(str, coverage)) + "d history")
        def total(key):
            return ("≥" if row.get(key + "Incomplete") else "") + money(row[key])
        stable = total("stablePairVolumeUsd24h") + " / " + total("stablePairTvlUsd")
        stock = total("stockPairVolumeUsd24h") + " / " + total("stockPairTvlUsd")
        if row.get("stablePairTvlUsdIncomplete"):
            reasons.append("best TVL among reported pools; some TVLs unknown")
        lines.append(f"| {row['symbol']} | {age} | {medians} | {shares} | {money(row['bestStablePoolTvlUsd'])} | {stable} | {stock} | {listing} | {'; '.join(reasons) or 'cutoff pending'} |")
    return "\n".join(lines) + "\n"


def write_history_csv(report, path):
    fields = ["symbol", "ticker", "issuer", "alreadyInManifest", "observedAgeDays", "ageIsLowerBound",
              "median7dUsd", "median30dUsd", "median90dUsd", "daysAtLeast1000Pct7d", "daysAtLeast1000Pct30d", "daysAtLeast1000Pct90d",
              "bestStablePoolTvlUsd", "stablePairVolumeUsd24h", "stablePairTvlUsd", "stockPairVolumeUsd24h", "stockPairTvlUsd", "usListedKind", "reasons", "notes",
              "stablePairVolumeUsd24hIncomplete", "stablePairTvlUsdIncomplete", "stockPairVolumeUsd24hIncomplete", "stockPairTvlUsdIncomplete"]
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in report["tokens"]:
            values = {"symbol": row["symbol"], "ticker": row["ticker"], "issuer": row["kind"],
                      "alreadyInManifest": row["alreadyInManifest"], "observedAgeDays": row["ageDays"],
                      "ageIsLowerBound": row["ageIsLowerBound"], "usListedKind": row["usListed"]["kind"] if row["usListed"] else "unconfirmed",
                      "reasons": "; ".join(row["reasons"]), "notes": "; ".join(row["notes"])}
            for size in (7, 30, 90):
                values[f"median{size}dUsd"] = row["windows"][str(size)]["medianDailyUsd"]
                values[f"daysAtLeast1000Pct{size}d"] = row["windows"][str(size)]["shareDaysAtLeast1000Pct"]
            for key in fields[12:17]:
                values[key] = row[key]
            for key in fields[20:]:
                values[key] = row.get(key, False)
            writer.writerow(values)


def sustained_report(args):
    recording = json.loads(args.history_input.read_text())
    rows = sorted(recording["accepted"] + recording["pending"], key=lambda r: (r["kind"], r["ticker"]))
    if len({r["address"] for r in rows}) != len(rows):
        raise ValueError("duplicate candidate token")
    config = json.loads((DEPLOY / "assets.json").read_text())
    configured = {r["address"].lower() for r in config["assets"]}
    cache = HistoryCache(args.cache)
    cache.registry_addresses = {r["address"].lower() for key in ("accepted", "pending", "excluded") for r in recording[key]}
    listings, listing_sources = listing_directory(cache)
    out = []
    report = {"asOfUnix": cache.data["asOfUnix"], "completedDaysThroughUtc": datetime.fromtimestamp(cache.cutoff - DAY, timezone.utc).strftime("%Y-%m-%d"),
              "cutoffSelected": False, "listingSources": listing_sources, "tokens": out,
              "notes": ["Median and ≥$1000 share require every day in the window; partial windows are null.",
                        "bStock age is observed K-Line coverage (lower bound at the 95-candle cap).",
                        "Ondo age is the oldest discovered eligible pool, not token deployment age.",
                        "Ondo historical statistics use the single highest-TVL eligible pool; current snapshot totals cover all discovered eligible pools separately from stock pools.",
                        "Chart omissions after the first returned candle are no reported volume ($0); failed requests and pre-history days stay missing.",
                        "Current partial UTC day is excluded. Chain sources and quote depth remain unverified."]}
    # Independent tokens can progress during another token's retry/backoff. All
    # requests still share the same host rate limit and atomic cache lock.
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(inspect_history, row, cache, listings, configured): row for row in rows}
        for future in as_completed(futures):
            row = futures[future]
            out.append(future.result())
            out.sort(key=lambda r: (r["kind"], r["ticker"]))
            if args.report:
                args.report.write_text(json.dumps(report, indent=2) + "\n")
            print(f"history {len(out)}/{len(rows)}: {row['symbol']}", flush=True)
    print(render_history(report), flush=True)
    if args.table:
        args.table.write_text(render_history(report))
    if args.csv:
        write_history_csv(report, args.csv)
    return 0


def decimal(value):
    if value is None or isinstance(value, bool):
        raise ValueError("missing numeric reading")
    try:
        out = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError("invalid numeric reading") from exc
    if not out.is_finite() or out < 0:
        raise ValueError("invalid numeric reading")
    return out


def fetch(url):
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = json.load(response)
            if payload.get("code") != "000000" or payload.get("success") is False:
                raise ValueError(f"public endpoint refused: code {payload.get('code')}")
            if payload.get("data") is None:
                raise ValueError("public endpoint returned no data")
            return payload["data"]
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            if attempt == 2:
                # Exceptions may contain request details. Do not print their raw text.
                raise ValueError(f"public data unavailable ({type(exc).__name__})") from None
            time.sleep(attempt + 1)


def inspect_public(row, kind, token_data, rwa_data=None):
    result = {"symbol": row["symbol"], "ticker": row["ticker"],
              "address": row["contractAddress"].lower(), "kind": kind,
              "volumeUsd24h": None, "multiplierE18": None, "reasons": []}
    if kind == "xstocks":
        result["reasons"].append("xStocks always excluded")
        return result
    try:
        # The headline volume24h includes off-chain stock volume. Only raw onchain
        # buy + sell volume is eligible, exactly as the engine's facts adapter uses.
        with localcontext() as context:
            context.prec = 80
            volume = decimal(token_data.get("volume24hBuy")) + decimal(token_data.get("volume24hSell"))
        result["volumeUsd24h"] = str(volume)
        if volume < 1000:
            result["reasons"].append("ghost: raw 24h volume below $1,000")
    except ValueError:
        result["reasons"].append("raw 24h volume unavailable")
    if kind == "ondo":
        try:
            with localcontext() as context:
                context.prec = 80
                a = decimal(row.get("multiplier"))
                b = decimal((rwa_data or {}).get("tokenInfo", {}).get("sharesMultiplier"))
                if a <= 0 or b <= 0:
                    raise ValueError("zero multiplier")
                if abs(a - b) * 1000 > min(a, b):
                    result["reasons"].append("Ondo multiplier sources disagree by more than 0.1%")
                else:
                    result["multiplierE18"] = str(int(b * E18))
        except ValueError:
            result["reasons"].append("no accepted Ondo multiplier: two readable positive sources required")
    return result


def qualify(public, reading, manager):
    result = {**public, "reasons": list(public["reasons"]), "pending": []}
    if result["reasons"]:
        return result
    if reading.get("quoteRefusedReason"):
        result["reasons"].append(f"quote refused: {reading['quoteRefusedReason']}")
    if public["kind"] == "bstock":
        multiplier = reading.get("uiMultiplierE18")
        if not isinstance(multiplier, str) or not multiplier.isdigit() or int(multiplier) <= 0:
            result["pending"].append("no verified onchain uiMultiplier() reading")
        else:
            result["multiplierE18"] = multiplier
    pause_manager = reading.get("pauseManager")
    if (not isinstance(pause_manager, str) or not ADDRESS.fullmatch(pause_manager)
            or int(pause_manager, 16) == 0 or not isinstance(reading.get("paused"), bool)):
        result["pending"].append("no verified token-specific pause source reading")
    elif public["kind"] == "bstock" and pause_manager.lower() != manager.lower():
        result["reasons"].append("bStock pause manager differs from deploy configuration")
    elif reading["paused"]:
        result["reasons"].append("issuer pause source currently reports paused")
    return result


def collect():
    rows = []
    for provider, kind in KINDS.items():
        registry = fetch(f"{BAPI}/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai?type={provider}")
        if not isinstance(registry, list):
            raise ValueError("registry response is not a list")
        rows.extend((row, kind) for row in registry if str(row.get("chainId")) == "56")

    def load(item):
        row, kind = item
        if kind == "xstocks":
            return inspect_public(row, kind, {})
        address = row.get("contractAddress")
        if not isinstance(address, str) or not ADDRESS.fullmatch(address):
            raise ValueError("registry contains an invalid token address")
        query = f"?chainId=56&contractAddress={address}"
        try:
            token_data = fetch(f"{WEB3}/v4/public/wallet-direct/buw/wallet/market/token/dynamic/info/ai{query}")
        except ValueError:
            token_data = {}
        rwa_data = None
        if kind == "ondo":
            try:
                rwa_data = fetch(f"{BAPI}/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai{query}")
            except ValueError:
                rwa_data = {}
        return inspect_public(row, kind, token_data, rwa_data)

    with ThreadPoolExecutor(max_workers=6) as pool:
        return sorted(pool.map(load, rows), key=lambda row: (row["ticker"], row["kind"]))


BATCH_BSTOCK = "SPCXB GMEB BABAB GOOGLB SKHYB MSTRB CRCLB SNDKB SOXLB DJTB HOODB MSFTB INTCB METAB MRNAB SOXSB AMZNB BMNRB FLNCB TSMB TQQQB NFLXB SQQQB".split()
BATCH_ONDO = "SPCXon GMEon GOOGLon SKHYon MSTRon CRCLon SNDKon SOXLon HOODon MSFTon INTCon METAon MRNAon SOXSon AMZNon BMNRon TSMon TQQQon NFLXon SQQQon".split()
HELD_TICKERS = {"SOXL", "SOXS", "TQQQ", "SQQQ"}


def load_batch(path):
    batch = json.loads(path.read_text())
    if batch.get("schema") != 1 or batch.get("chainId") != 56:
        raise ValueError("Batch 1 requires schema 1 and BSC chain 56")
    rows = batch["tokens"]
    candidates = [r for r in rows if r["role"] == "candidate"]
    controls = [r for r in rows if r["role"] == "control"]
    expected_controls = {t + suffix for t in ("AAPL", "NVDA", "QQQ", "SPY", "TSLA") for suffix in ("B", "on")}
    if (len(rows) != 53 or len(candidates) != 43 or len(controls) != 10
            or {r["symbol"] for r in candidates} != set(BATCH_BSTOCK + BATCH_ONDO)
            or {r["symbol"] for r in controls} != expected_controls):
        raise ValueError("list differs from the chief engineer's fixed Batch 1 and controls")
    if len({r["address"].lower() for r in rows}) != 53:
        raise ValueError("duplicate Batch 1 address")
    for row in rows:
        if not ADDRESS.fullmatch(row["address"]) or int(row["address"], 16) == 0:
            raise ValueError("invalid Batch 1 address")
        kind = "ondo" if row["symbol"].endswith("on") else "bstock"
        if row["kind"] != kind or row["multiplierSource"] != ("feed" if kind == "ondo" else "ui"):
            raise ValueError("incorrect Batch 1 issuer or multiplier source")
        if row["held"] != (row["ticker"] in HELD_TICKERS):
            raise ValueError("held product status differs from the chief engineer's decision")
    if not all(r["held"] for r in rows[-8:]) or any(r["held"] for r in rows[:-8]):
        raise ValueError("the eight held assets must be last")
    if not ADDRESS.fullmatch(batch["bstockPauseManager"]) or int(batch["bstockPauseManager"], 16) == 0:
        raise ValueError("invalid shared pause manager")
    return batch


class PublicChainReads:
    """Keyless public reads only; never consult environment/provider configuration.

    The Batch 1 decision explicitly authorizes public RPC reads. Transport details
    stay in memory and are never included in recordings, logs or exceptions.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.last_request = 0

    def call(self, method, params):
        if method not in {"eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call"}:
            raise ValueError("non-read RPC method refused")
        if method == "eth_call" and params[0]["data"][:10] not in {"0xa60bf13d", "0x461ad792", "0x5e76ad54"}:
            raise ValueError("unexpected contract read selector")
        # Fixed public host, assembled at request time; no configured URL/key read.
        endpoint = "https://" + ".".join(["-".join(["bsc", "dataseed"]), "binance", "org"])
        for attempt in range(3):
            with self.lock:
                delay = max(0, self.last_request + 0.25 - time.monotonic())
                self.last_request = time.monotonic() + delay
            if delay:
                time.sleep(delay)
            try:
                payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
                request = urllib.request.Request(endpoint, data=payload, method="POST", headers={
                    "Content-Type": "application/json", "User-Agent": "tally-wo09-read-only"})
                with urllib.request.urlopen(request, timeout=20) as response:
                    data = json.load(response)
                if data.get("error"):
                    raise ValueError(f"{method} refused (RPC code {data['error'].get('code')})")
                if data.get("result") is None:
                    raise ValueError(f"{method} returned no result")
                return data["result"]
            except (urllib.error.URLError, TimeoutError) as exc:
                if attempt == 2:
                    raise ValueError(f"{method} transport unavailable ({type(exc).__name__})") from None
                time.sleep(attempt + 1)


def decode_word(raw):
    if not isinstance(raw, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", raw):
        raise ValueError("contract read did not return exactly one ABI word")
    return int(raw, 16)


def positive_e18(raw):
    with localcontext() as context:
        context.prec = 80
        value = int(decimal(raw) * E18)
    if value <= 0 or value >= 2**256:
        raise ValueError("multiplier must be positive uint256")
    return value


def inspect_batch_fact(row, rpc, block, manager, list_readings):
    result = {**row, "multiplierE18": None, "secondaryMultiplierE18": None,
              "sourceDifferencePct": None, "pauseManager": None, "paused": None, "reasons": []}
    address = row["address"].lower()
    try:
        code = rpc.call("eth_getCode", [address, block])
        if not isinstance(code, str) or code in ("0x", "0x0", "0x00"):
            raise ValueError("token has no readable contract code")
        if row["kind"] == "bstock":
            value = decode_word(rpc.call("eth_call", [{"to": address, "data": "0xa60bf13d"}, block]))
            if not 0 < value < 2**256:
                raise ValueError("uiMultiplier() is zero or invalid")
            result["multiplierE18"] = str(value)
            result["multiplierSource"] = "onchain uiMultiplier()"
        else:
            dynamic = fetch(f"{BAPI}/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=56&contractAddress={address}")
            value = positive_e18((dynamic.get("tokenInfo") or {}).get("sharesMultiplier"))
            other = positive_e18(list_readings.get(address))
            result["multiplierE18"] = str(value)
            result["secondaryMultiplierE18"] = str(other)
            result["multiplierSource"] = "public RWA dynamic sharesMultiplier; public list multiplier"
            with localcontext() as context:
                context.prec = 80
                result["sourceDifferencePct"] = str(Decimal(abs(value - other)) * 100 / min(value, other))
            if abs(value - other) * 1000 > min(value, other):
                result["reasons"].append("Ondo multiplier sources differ by more than 0.1%")
    except (ValueError, KeyError, TypeError) as exc:
        detail = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        result["reasons"].append("multiplier unavailable: " + detail)
    # Check pause independently so a bad multiplier cannot conceal another failure.
    try:
        pm = manager.lower()
        if row["kind"] == "ondo":
            word = decode_word(rpc.call("eth_call", [{"to": address, "data": "0x461ad792"}, block]))
            if not 0 < word < 2**160:
                raise ValueError("tokenPauseManager() returned zero or invalid address")
            pm = "0x" + f"{word:040x}"
        result["pauseManager"] = pm
        code = rpc.call("eth_getCode", [pm, block])
        if not isinstance(code, str) or code in ("0x", "0x0", "0x00"):
            raise ValueError("pause manager has no readable contract code")
        paused = decode_word(rpc.call("eth_call", [{"to": pm, "data": "0x5e76ad54" + address[2:].rjust(64, "0")}, block]))
        if paused not in (0, 1):
            raise ValueError("isTokenPaused() returned invalid bool")
        result["paused"] = bool(paused)
        if paused:
            result["reasons"].append("issuer pause manager currently reports paused")
    except (ValueError, KeyError, TypeError) as exc:
        detail = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        result["reasons"].append("pause source unavailable: " + detail)
    result["factsPass"] = not result["reasons"]
    return result


def render_batch_facts(report):
    lines = [f"BSC block {report['blockNumber']} ({report['blockUtc']}); multiplier units: shares/token.",
             "| Token | Group | Multiplier | Source difference % | Pause manager | Paused | Facts result |",
             "|---|---|---:|---:|---|---|---|"]
    for row in report["tokens"]:
        value = "—" if row["multiplierE18"] is None else format(Decimal(row["multiplierE18"]) / E18, "f")
        group = "control" if row["role"] == "control" else "held" if row["held"] else "candidate"
        paused = "—" if row["paused"] is None else "yes" if row["paused"] else "no"
        diff = row["sourceDifferencePct"] or "—"
        lines.append(f"| {row['symbol']} | {group} | {value} | {diff} | {row['pauseManager'] or '—'} | {paused} | {'PASS' if row['factsPass'] else '; '.join(row['reasons'])} |")
    return "\n".join(lines) + "\n"


def batch_onchain_report(args):
    batch = load_batch(args.batch_onchain)
    rpc = PublicChainReads()
    if int(rpc.call("eth_chainId", []), 16) != 56:
        raise ValueError("public chain is not BSC")
    block = rpc.call("eth_blockNumber", [])
    header = rpc.call("eth_getBlockByNumber", [block, False])
    selected = {r["address"].lower() for r in batch["tokens"] if r["kind"] == "ondo"}
    # The list is one required multiplier source. Retain only the fixed addresses;
    # no new ticker discovery, dynamic/volume calls or selection are performed.
    listing = fetch(f"{BAPI}/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai?type=1")
    readings = {r["contractAddress"].lower(): r.get("multiplier") for r in listing
                if str(r.get("chainId")) == "56" and r["contractAddress"].lower() in selected}
    report = {"schema": 1, "chainId": 56, "observedAtUnix": int(time.time()), "blockNumber": int(block, 16),
              "blockUtc": datetime.fromtimestamp(int(header["timestamp"], 16), timezone.utc).isoformat(),
              "bstockPauseManager": batch["bstockPauseManager"], "tokens": [],
              "notes": ["Read-only; no assets/seeds changed. Held products remain held even when facts pass.",
                        "Ondo public dynamic/list readings use the gen_assets.py agreement rule; authenticated ratio is checked later on EC2.",
                        "Depth captures and fork tests remain required; facts PASS is not approval to enable."]}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(inspect_batch_fact, row, rpc, block, batch["bstockPauseManager"], readings) for row in batch["tokens"]]
        for future in futures:
            row = future.result()
            report["tokens"].append(row)
            if args.report:
                args.report.write_text(json.dumps(report, indent=2) + "\n")
            print(f"facts {len(report['tokens'])}/53: {row['symbol']} {'PASS' if row['factsPass'] else 'DROP'}", flush=True)
    print(render_batch_facts(report))
    if args.table:
        args.table.write_text(render_batch_facts(report))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--chain-readings", type=Path)
    parser.add_argument("--write-assets", action="store_true", help="Only after chief engineer reviews the candidate list")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--history-input", type=Path, help="Previous public candidate report; sustained-volume mode")
    parser.add_argument("--cache", type=Path, default=Path("/tmp/shareguard-volume-cache.json"))
    parser.add_argument("--table", type=Path, help="Write the sustained-volume Markdown table")
    parser.add_argument("--csv", type=Path, help="Write the sustained-volume table as CSV")
    parser.add_argument("--batch-onchain", type=Path, help="Check only the fixed Batch 1 list; read-only public chain/API facts")
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(CandidateTests)
        return 0 if unittest.TextTestRunner().run(suite).wasSuccessful() else 1
    if args.batch_onchain:
        if args.write_assets or args.history_input or args.chain_readings:
            parser.error("Batch 1 checks never discover assets, write assets or generate seeds")
        return batch_onchain_report(args)
    if args.history_input:
        if args.write_assets or args.chain_readings:
            parser.error("sustained-volume mode is a report only; chief engineer chooses the cutoff")
        return sustained_report(args)
    config = json.loads((DEPLOY / "assets.json").read_text())
    readings = {}
    if args.chain_readings:
        recording = json.loads(args.chain_readings.read_text())
        if recording.get("chainId") != 56:
            parser.error("chain readings must be for chainId 56")
        observed = recording.get("observedAtUnix")
        if not isinstance(observed, int) or not 0 <= time.time() - observed <= 7200:
            parser.error("chain readings must be within two hours, with no future timestamp")
        readings = {address.lower(): value for address, value in recording["tokens"].items()}
    public = collect()
    inspected = [qualify(row, readings.get(row["address"], {}), config["bstockPauseManager"]) for row in public]
    accepted = [row for row in inspected if not row["reasons"] and not row["pending"]]
    pending = [row for row in inspected if not row["reasons"] and row["pending"]]
    excluded = [row for row in inspected if row["reasons"]]
    print("PUBLIC SHORTLIST — quote execution still requires chief engineer's captures")
    for row in accepted + pending:
        print(f"{row['symbol']:12} {row['kind']:7} ${row['volumeUsd24h']}  "
              f"{'PENDING: ' + '; '.join(row['pending']) if row['pending'] else 'chain sources verified'}")
    print("\nEXCLUDED")
    for row in excluded:
        print(f"{row['symbol']:12} {row['kind']:7} {'; '.join(row['reasons'])}")
    print(f"\n{len(accepted)} source-verified, {len(pending)} pending chain checks, {len(excluded)} excluded")
    report = {"observedAtUnix": int(time.time()), "chainId": 56,
              "quoteStatus": "not checked: authenticated captures belong to chief engineer",
              "accepted": accepted, "pending": pending, "excluded": excluded}
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    if args.write_assets:
        if not accepted:
            parser.error("no source-verified candidates; assets.json was not changed")
        # Existing configured assets are retained even if current volume has fallen.
        entries = {row["address"].lower(): row for row in config["assets"]}
        for row in accepted:
            entries[row["address"]] = {key: row[key] for key in ("symbol", "ticker", "address", "kind")}
        config["assets"] = list(entries.values())
        config["count"] = len(entries)
        (DEPLOY / "assets.json").write_text(json.dumps(config, indent=2) + "\n")
    return 0


class CandidateTests(unittest.TestCase):
    def row(self, multiplier="1"):
        return {"symbol": "TESTon", "ticker": "TEST", "contractAddress": "0x" + "1" * 40, "multiplier": multiplier}

    def test_uses_raw_volume_not_headline(self):
        row = inspect_public(self.row(), "bstock", {"volume24h": "999999999", "volume24hBuy": "1", "volume24hSell": "2"})
        self.assertEqual(row["volumeUsd24h"], "3")
        self.assertIn("ghost", row["reasons"][0])

    def test_threshold_is_inclusive_and_decimal_exact(self):
        row = inspect_public(self.row(), "bstock", {"volume24hBuy": "999.999999999999999999", "volume24hSell": "0.000000000000000001"})
        self.assertEqual(row["reasons"], [])

    def test_missing_volume_is_not_zero(self):
        row = inspect_public(self.row(), "bstock", {})
        self.assertIn("unavailable", row["reasons"][0])

    def test_xstocks_always_out(self):
        self.assertEqual(inspect_public(self.row(), "xstocks", {})["reasons"], ["xStocks always excluded"])

    def test_ondo_sources_must_agree(self):
        row = inspect_public(self.row(), "ondo", {"volume24hBuy": "1000", "volume24hSell": "0"}, {"tokenInfo": {"sharesMultiplier": "1.002"}})
        self.assertIsNone(row["multiplierE18"])
        self.assertIn("disagree", row["reasons"][0])

    def test_ondo_ten_shares_is_not_assumed_one(self):
        row = inspect_public(self.row("10"), "ondo", {"volume24hBuy": "1000", "volume24hSell": "0"}, {"tokenInfo": {"sharesMultiplier": "10"}})
        self.assertEqual(row["multiplierE18"], str(10 * E18))

    def test_sources_are_not_guessed(self):
        row = inspect_public(self.row(), "bstock", {"volume24hBuy": "1000", "volume24hSell": "0"})
        self.assertEqual(len(qualify(row, {}, "0x" + "2" * 40)["pending"]), 2)

    def test_pause_and_quote_refusal_exclude(self):
        row = inspect_public(self.row(), "bstock", {"volume24hBuy": "1000", "volume24hSell": "0"})
        reading = {"uiMultiplierE18": str(E18), "pauseManager": "0x" + "2" * 40, "paused": True, "quoteRefusedReason": "RFQ required"}
        self.assertEqual(len(qualify(row, reading, "0x" + "2" * 40)["reasons"]), 2)

    def test_partial_day_is_dropped_and_decimal_usd_is_preserved(self):
        candles = [[DAY * 10, 0, 0, 0, 0, "2000.000000000000001"],
                   [DAY * 11, 0, 0, 0, 0, "999999"]]
        self.assertEqual(daily_candles(candles, DAY * 11), {DAY * 10: Decimal("2000.000000000000001")})

    def test_zero_days_are_included_in_median_and_share(self):
        cutoff = 100 * DAY
        days = {cutoff - DAY * i: Decimal(2000 if i <= 3 else 0) for i in range(1, 8)}
        result = window_metrics(days, cutoff)["7"]
        self.assertEqual(result["medianDailyUsd"], "0")
        self.assertEqual(result["daysAtLeast1000"], 3)

    def test_missing_days_never_pass_a_full_window(self):
        result = window_metrics({DAY * 9: Decimal(100000)}, DAY * 10)["7"]
        self.assertFalse(result["complete"])
        self.assertIsNone(result["medianDailyUsd"])
        self.assertIsNone(result["shareDaysAtLeast1000Pct"])
        self.assertEqual(result["coveredDays"], 1)

    def test_pool_pair_uses_contract_identity(self):
        stock = "0x" + "1" * 40
        pool = {"relationships": {"base_token": {"data": {"id": "bsc_" + stock}},
                                  "quote_token": {"data": {"id": "bsc_" + "0x" + "2" * 40}}}}
        self.assertNotIn(pool_counterpart(pool, stock), STABLE_COUNTERPARTS)

    def test_null_pool_metrics_are_lower_bounds_not_zero_readings(self):
        self.assertEqual(pool_metric_total([{"tvlUsd": "123.45"}, {"tvlUsd": None}], "tvlUsd"), ("123.45", True))
        self.assertEqual(pool_metric_total([{"tvlUsd": "0"}], "tvlUsd"), ("0", False))
        self.assertEqual(pool_metric_total([], "tvlUsd"), ("0", False))

    def test_contract_words_are_exact_abi_words(self):
        self.assertEqual(decode_word("0x" + "0" * 63 + "1"), 1)
        for raw in ("0x", "0x1", "0x" + "0" * 65, "0x" + "z" * 64):
            with self.assertRaises(ValueError):
                decode_word(raw)

    def test_public_chain_transport_refuses_writes_and_unknown_selectors(self):
        reader = PublicChainReads()
        with self.assertRaises(ValueError):
            reader.call("eth_sendRawTransaction", ["0x"])
        with self.assertRaises(ValueError):
            reader.call("eth_call", [{"data": "0xdeadbeef"}, "latest"])

    def test_fixed_batch_preserves_controls_and_held_last(self):
        batch = load_batch(DEPLOY / "batch-1.json")
        self.assertEqual(sum(r["role"] == "control" for r in batch["tokens"]), 10)
        self.assertEqual(sum(r["role"] == "candidate" for r in batch["tokens"]), 43)
        self.assertEqual(sum(r["held"] for r in batch["tokens"]), 8)
        self.assertTrue(all(r["held"] for r in batch["tokens"][-8:]))

    def test_batch_bigint_multiplier_and_manager_reads_are_pinned(self):
        class Reader:
            def call(self, method, params):
                self_test.assertEqual(params[-1], "0x123")
                if method == "eth_getCode":
                    return "0x1234"
                if params[0]["data"] == "0xa60bf13d":
                    return "0x" + f"{10000000000000000001:064x}"
                return "0x" + "0" * 64
        self_test = self
        row = {"symbol": "TESTB", "address": "0x" + "1" * 40, "kind": "bstock", "role": "candidate", "held": False}
        out = inspect_batch_fact(row, Reader(), "0x123", "0x" + "2" * 40, {})
        self.assertTrue(out["factsPass"])
        self.assertEqual(out["multiplierE18"], "10000000000000000001")
        self.assertFalse(out["paused"])

    def test_ondo_disagreement_and_missing_readings_do_not_hide_pause_facts(self):
        from unittest.mock import patch
        class Reader:
            def call(self, method, params):
                if method == "eth_getCode":
                    return "0x1234"
                if params[0]["data"] == "0x461ad792":
                    return "0x" + "0" * 24 + "2" * 40
                return "0x" + "0" * 64
        row = {"symbol": "TESTon", "address": "0x" + "1" * 40, "kind": "ondo", "role": "candidate", "held": False}
        for readings in ({row["address"]: "1"}, {}):
            with patch(__name__ + ".fetch", return_value={"tokenInfo": {"sharesMultiplier": "10"}}):
                out = inspect_batch_fact(row, Reader(), "0x123", "0x" + "3" * 40, readings)
            self.assertFalse(out["factsPass"])
            self.assertEqual(out["pauseManager"], "0x" + "2" * 40)
            self.assertFalse(out["paused"])
            self.assertEqual(len(out["reasons"]), 1)

    def test_unreadable_pause_manager_is_dropped_and_held_status_survives(self):
        class Reader:
            def call(self, method, params):
                if method == "eth_getCode":
                    return "0x" if params[0] == "0x" + "2" * 40 else "0x1234"
                return "0x" + f"{E18:064x}"
        row = {"symbol": "TESTB", "address": "0x" + "1" * 40, "kind": "bstock", "role": "candidate", "held": True}
        out = inspect_batch_fact(row, Reader(), "0x123", "0x" + "2" * 40, {})
        self.assertFalse(out["factsPass"])
        self.assertTrue(out["held"])
        self.assertIsNone(out["paused"])
        self.assertIn("pause manager has no readable contract code", out["reasons"][0])

    def test_successful_chart_gaps_are_no_reported_activity_but_pre_history_is_missing(self):
        days, omitted = recorded_calendar({DAY * 8: Decimal(1000)}, DAY * 11)
        self.assertEqual(days, {DAY * 8: Decimal(1000), DAY * 9: Decimal(0), DAY * 10: Decimal(0)})
        self.assertEqual(omitted, 2)
        self.assertNotIn(DAY * 7, days)
        self.assertEqual(recorded_calendar({}, DAY * 11), ({}, 0))

    def test_directory_confirms_stocks_and_etfs_but_not_warrants_or_test_issues(self):
        class Directory:
            def get(self, url, text=False):
                if "nasdaqlisted" in url:
                    return ("Symbol|Security Name|Test Issue|ETF\n"
                            "ASML|ASML Holding N.V. - New York Registry Shares|N|N\n"
                            "SHOP|Shopify Inc. - Class A Subordinate Voting Shares|N|N\n"
                            "SPY|SPDR S&P 500 ETF Trust|N|Y\n"
                            "FAKE|A Fake Test Common Stock|Y|N\n"
                            "WARRANT|A Corp Warrants to purchase Common Stock|N|N\n")
                return "ACT Symbol|Security Name|Test Issue|ETF\n"
        entries, _ = listing_directory(Directory())
        self.assertEqual(set(entries), {"ASML", "SHOP", "SPY"})
        self.assertEqual(entries["ASML"]["kind"], "stock")
        self.assertEqual(entries["SPY"]["kind"], "ETF")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError) as error:
        raise SystemExit(f"candidate report failed ({type(error).__name__}); no assets written") from None
