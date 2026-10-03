"""Read-only F6/F11 evidence recorder; no signing or live trading endpoints.

Run from the repo root: python3 spike/record_receipt_vectors.py
Reads only BSC_RPC_NODEREAL (endpoint or provider credential) from the environment or root .env. Never records
the endpoint. Each output is a new file opened exclusively (no overwrites).
Historical calls replay at block - 1 with the original gas cap: they are
reconstructions, not the original pre-trade simulations.
"""

import datetime as dt
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
VECTORS = {
    "F6_NVDAB": "0x726aace915e720ca46f4cfb344a7283c4aa1ef59bde225fdea9796e2f0eb0ba7",
    "F6_NVDAon": "0xb3ab17385d3872dfaec05367582739a10b08a9586861c56e02f1c2e264c49637",
    "F6_failed_NVDAon": "0xfd7799e772868512799e7a114186a1778c506db765e0b54e05aa583f4481a40c",
    "F11_NVDAB": "0xb678802dfb1dfa6e1206ac01fdf79d18181d5d61bab23d307b7ea059abc39a8e",
    "F11_NVDAon": "0x55ec244764dae2778357a7a446f5ec95de03cf2243fbff3ea1f3b4458a22e11a",
}


def endpoint():
    value = os.environ.get("BSC_RPC_NODEREAL")
    if not value and (ROOT / ".env").exists():
        for line in (ROOT / ".env").read_text().splitlines():
            match = re.match(r"^\s*(?:export\s+)?BSC_RPC_NODEREAL\s*=\s*(.*)$", line)
            if match:
                value = match[1].strip()
                if value.startswith(("'", '"')):
                    value = value[1:value.rfind(value[0])]
                else:
                    value = value.split(" #", 1)[0].strip()
    # https://docs.nodereal.io/reference/find-api-key-endpoint
    if value and re.fullmatch(r"[a-zA-Z0-9]{32}", value):
        value = "https://bsc-mainnet.nodereal.io/v1/" + value
    if not value or urlsplit(value).scheme not in {"https", "http"}:
        raise SystemExit("BSC_RPC_NODEREAL missing or invalid; no endpoint printed")
    return value


def main():
    rpc_url = endpoint()
    # Redact URL and credential-like URL segments if a provider echoes them.
    parts = urlsplit(rpc_url)
    sensitive = [rpc_url, parts.netloc, *parts.path.split("/"), *parts.query.split("&")]
    sensitive = [s for s in sensitive if len(s) >= 12]

    def redact(value):
        if isinstance(value, str):
            for secret in sensitive:
                value = value.replace(secret, "[redacted]")
            return re.sub(r"https?://[^\s\"'<>]+", "[redacted endpoint]", value)
        if isinstance(value, list):
            return [redact(v) for v in value]
        if isinstance(value, dict):
            return {k: redact(v) for k, v in value.items()}
        return value

    request_id = 0

    def rpc(method, params):
        nonlocal request_id
        request_id += 1
        payload = json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        request = urllib.request.Request(rpc_url, payload.encode(), {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                body = json.load(response)
            if "error" in body:
                return {"ok": False, "error": redact(body["error"])}
            if "result" not in body:
                return {"ok": False, "error": {"message": "RPC response missing result"}}
            return {"ok": True, "result": body["result"]}
        except urllib.error.HTTPError as error:
            return {"ok": False, "error": {"message": "HTTP refusal", "status": error.code}}
        except (OSError, ValueError) as error:
            # Exception text may contain credentials from a URL. Store only its class.
            return {"ok": False, "error": {"message": type(error).__name__}}

    recorded_at = dt.datetime.now(dt.timezone.utc)
    evidence = {
        "recordedAt": recorded_at.isoformat(),
        "source": "NodeReal BSC RPC",
        "chainId": rpc("eth_chainId", []),
        "historicalCallNote": "Reconstruction at blockNumber - 1, original calldata and gas cap; not the original simulation.",
        "vectors": {},
    }
    if evidence["chainId"] != {"ok": True, "result": "0x38"}:
        raise SystemExit("BSC chain verification failed; no endpoint printed")
    for name, tx_hash in VECTORS.items():
        transaction = rpc("eth_getTransactionByHash", [tx_hash])
        receipt = rpc("eth_getTransactionReceipt", [tx_hash])
        vector = {"txHash": tx_hash, "transaction": transaction, "receipt": receipt}
        tx = transaction.get("result")
        rec = receipt.get("result")
        if tx and rec and rec.get("blockNumber"):
            block = hex(int(rec["blockNumber"], 16) - 1)
            call = {k: tx[k] for k in ("from", "to", "value", "gas", "gasPrice") if tx.get(k) is not None}
            call["data"] = tx["input"]
            vector["historicalCall"] = {"block": block, "request": call, **rpc("eth_call", [call, block])}
        else:
            vector["historicalCall"] = {"ok": False, "error": {"message": "Transaction or mined receipt unavailable"}}
        evidence["vectors"][name] = vector
        print(f"{name}: transaction={bool(tx)}, receipt={bool(rec)}, historicalCall={vector['historicalCall']['ok']}", flush=True)

    output = ROOT / "spike" / "results" / f"receipt_vectors_{recorded_at.strftime('%Y%m%dT%H%M%S%fZ')}.json"
    with output.open("x") as file:
        json.dump(redact(evidence), file, indent=2)
        file.write("\n")
    print(f"Recorded {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
