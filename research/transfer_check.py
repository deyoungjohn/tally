"""Can a freshly deployed contract receive (and a contract send) tokenized stocks on BSC?

Simulates ERC-20 transfer() calls with eth_call. Nothing is signed, broadcast or spent.
  * "fresh EOA": a random address with no history
  * "fresh contract": a random address given bytecode via a state override, i.e. what a
    just-deployed vault/router looks like to the token's compliance hook
  * the sender is a real contract that already holds the token
A control transfer (more than the balance) must revert, proving the simulation can fail.

    python3 research/transfer_check.py
"""
import json
import os
import urllib.request

RPC = os.environ.get("BSC_RPC", "https://bsc-dataseed.bnbchain.org")
TOKENS = {  # BSC NVDA on each issuer, from research/snapshot-*/rwa_list_*.json
    "NVDAon (Ondo)": "0xa9ee28c80f960b889dfbd1902055218cba016f75",
    "NVDAB (bStock)": "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    "NVDAx (xStocks)": "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
}
# Contracts seen routing these tokens in recent Transfer logs (routers, LI.FI, CoW settlement, ...)
CANDIDATE_HOLDERS = [
    "0x25ee4fa4bff5363d47496e68377b1241e8e21a47", "0x8f10b468b06c6fd214b65f87778827f7d113f996",
    "0xc4dc0a2a137fcc36af41edc0c5319ad4ac50f9a0", "0xdd9d5164ccbc57be377a964fc064135b03d06177",
    "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", "0x9008d19f58aabd9ed0d60971565aa8510560ab41",
]
BALANCE_OF, TRANSFER = "0x70a08231", "0xa9059cbb"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json",
                                                          "User-Agent": "curl/8"})
    return json.load(urllib.request.urlopen(req, timeout=20))


def word(x):
    return (x[2:].lower() if isinstance(x, str) else hex(x)[2:]).rjust(64, "0")


def transfer_ok(token, sender, to, amount, overrides):
    r = rpc("eth_call", [{"from": sender, "to": token, "data": TRANSFER + word(to) + word(amount)},
                         "latest", overrides])
    return "result" in r and r["result"].endswith("1"), r.get("error")


def main():
    fresh_eoa = "0x" + os.urandom(20).hex()
    fresh_contract = "0x" + os.urandom(20).hex()
    overrides = {fresh_contract: {"code": "0x00"}}
    print("fresh EOA", fresh_eoa, "| fresh contract", fresh_contract)
    for name, token in TOKENS.items():
        holder = next(((h, b) for h in CANDIDATE_HOLDERS
                       if (b := int(rpc("eth_call", [{"to": token, "data": BALANCE_OF + word(h)}, "latest"])
                                    .get("result") or "0x0", 16)) > 0), None)
        if not holder:
            print(f"{name}: no candidate holder has a balance right now; add a holder from BscTrace")
            continue
        sender, bal = holder
        print(f"{name}: sender {sender} (contract)")
        for label, dest in [("-> fresh EOA", fresh_eoa), ("-> fresh contract", fresh_contract)]:
            ok, err = transfer_ok(token, sender, dest, max(bal // 1000, 1), overrides)
            print(f"   {label:18s} {'OK' if ok else 'REVERT ' + json.dumps(err)[:160]}")
        ok, _ = transfer_ok(token, sender, fresh_contract, bal + 10**30, overrides)
        print(f"   {'control (overdraw)':18s} {'REVERT (expected)' if not ok else 'OK ?! simulation is not failing'}")


if __name__ == "__main__":
    main()
