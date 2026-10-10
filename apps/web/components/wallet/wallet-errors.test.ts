import { describe, expect, it } from "vitest";
import { bnbFromWei, friendlyWalletError, parseInsufficientGas } from "./wallet-errors";

const RAW = `Missing or invalid parameters. Double check you have provided the correct parameters. URL: https://bsc-mainnet.rpc.privy.systems/?privyAppId=abc Request body: {"method":"eth_sendRawTransaction","params":["0x02f9"]} Details: insufficient funds for gas * price + value: balance 82164950000000, tx cost 109077540000000, overshoot 26912590000000 Version: viem@2.56.0`;

describe("friendlyWalletError", () => {
  it("explains an insufficient-gas error with the figures, and shows no URL or request body", () => {
    const e = friendlyWalletError(Object.assign(new Error(RAW), { code: -32602 }));
    expect((e as { kind?: string }).kind).toBe("needs_gas");
    expect(e.message).toContain("enough BNB");
    expect(e.message).toContain("0.00011 BNB");
    expect(e.message).toContain("0.00009 BNB");
    expect(e.message).not.toMatch(/https?:|Request body|viem|0x02f9/);
  });
  it("still says it plainly when the figures are missing", () => {
    const e = friendlyWalletError(new Error("insufficient funds for gas * price + value"));
    expect((e as { kind?: string }).kind).toBe("needs_gas");
    expect(e.message).toContain("enough BNB");
  });
  it("recognises a busy wallet and a low fee", () => {
    expect((friendlyWalletError(new Error("nonce too low")) as { kind?: string }).kind).toBe(
      "nonce",
    );
    expect(
      (friendlyWalletError(new Error("replacement transaction underpriced")) as { kind?: string })
        .kind,
    ).toBe("underpriced");
  });
  it("strips the noise from an unknown viem error but keeps its short message", () => {
    const e = Object.assign(
      new Error(
        "The request failed. URL: https://x.example/?key=secret Request body: {} Version: viem@2.56.0",
      ),
      { shortMessage: "The request failed." },
    );
    expect(friendlyWalletError(e).message).toBe("The request failed.");
  });
  it("leaves an ordinary error alone", () => {
    const e = new Error("Wallet is locked");
    expect(friendlyWalletError(e)).toBe(e);
  });
});

describe("helpers", () => {
  it("parses the balance and cost and rounds BNB up", () => {
    expect(parseInsufficientGas(new Error(RAW))).toEqual({
      balance: 82164950000000n,
      cost: 109077540000000n,
    });
    expect(bnbFromWei(109077540000000n)).toBe("0.00011");
    expect(bnbFromWei(1n)).toBe("0.00001");
    expect(parseInsufficientGas(new Error("execution reverted"))).toBeNull();
  });
});
