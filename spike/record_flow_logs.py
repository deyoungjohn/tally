#!/usr/bin/env python3
"""Read-only BSC evidence. Load BSC_RPC_NODEREAL into the environment first.

Records one inclusive <=10,000-block window per token and at most 20
distinct receipts per token, selected by the largest Transfer amount.
Never prints provider URLs or exception text (HTTP errors can contain keys).
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import urllib.request

TOKENS = {
    "NVDAB": "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    "NVDAon": "0xa9ee28c80f960b889dfbd1902055218cba016f75",
}
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blocks", type=int, default=10000)
    parser.add_argument("--to-block", type=int)
    args = parser.parse_args()
    if not 1 <= args.blocks <= 10000:
        parser.error("--blocks must be between 1 and 10000")
    endpoint = os.environ.get("BSC_RPC_NODEREAL")
    if not endpoint:
        raise RuntimeError("BSC_RPC_NODEREAL is not set")

    def rpc(method, params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        req = urllib.request.Request(endpoint, body, {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as response:
            data = json.load(response)
        if "error" in data:
            raise RuntimeError("RPC rejected " + method)
        return data["result"]

    started = datetime.now(timezone.utc)
    head = args.to_block if args.to_block is not None else int(rpc("eth_blockNumber", []), 16) - 12
    first = max(0, head - args.blocks + 1)
    recording = {"_meta": {"startedAt": started.isoformat(), "provider": "NodeReal",
                            "fromBlock": first, "toBlock": head, "confirmations": 12}, "tokens": {}}
    blocks = {}
    for symbol, address in TOKENS.items():
        logs = rpc("eth_getLogs", [{"address": address, "topics": [TRANSFER],
                                    "fromBlock": hex(first), "toBlock": hex(head)}])
        receipts = {}
        for log in sorted(logs, key=lambda row: int(row["data"], 16), reverse=True):
            tx = log["transactionHash"]
            if tx in receipts:
                continue
            receipt = rpc("eth_getTransactionReceipt", [tx])
            if receipt is None:
                raise RuntimeError("Receipt unavailable")
            receipts[tx] = receipt
            if len(receipts) == 20:
                break
        for log in logs:
            number = log["blockNumber"]
            if "blockTimestamp" not in log:
                if number not in blocks:
                    blocks[number] = rpc("eth_getBlockByNumber", [number, False])["timestamp"]
                log["blockTimestamp"] = blocks[number]
        recording["tokens"][symbol] = {"address": address, "logs": logs, "receipts": receipts}
        print(f"{symbol}: {len(logs)} Transfers, {len(receipts)} receipts")
    finished = datetime.now(timezone.utc)
    recording["_meta"]["finishedAt"] = finished.isoformat()
    path = Path(__file__).parent / "results" / ("flow_logs_" + finished.strftime("%Y%m%dT%H%M%SZ") + ".json")
    path.write_text(json.dumps(recording, indent=2) + "\n")
    print(path)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Recording failed (" + type(error).__name__ + "); provider details withheld.", file=sys.stderr)
        sys.exit(1)
