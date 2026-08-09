/**
 * GuardRail x402 EOA buyer: pays for an agent report with $U.
 *
 * The SDK's fetchWithX402 signs with an ERC-1271 wrapped signature, which is
 * designed for Altana smart accounts. Our GuardRail buyer is a plain EOA, so
 * the $U token's ecrecover rejects the wrapped signature. This buyer signs
 * the EIP-3009 TransferWithAuthorization typed data directly with the raw
 * private key and emits the exact envelope the x402 merchant decodes.
 *
 * Usage: tsx src/x402-buy.ts http://127.0.0.1:8787/v1/agents/health
 */

import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const U_TOKEN = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address;
const RPC = "https://bsc-testnet-rpc.publicnode.com";

function loadAdminKey(): `0x${string}` {
  const f = join(process.cwd(), ".guardrail-state.json");
  if (!existsSync(f)) throw new Error("no .guardrail-state.json");
  return JSON.parse(readFileSync(f, "utf8")).adminKey as `0x${string}`;
}

async function main() {
  const url = process.argv[2] ?? "http://127.0.0.1:8787/v1/agents/health";
  const account = privateKeyToAccount(loadAdminKey());
  const pubClient = createPublicClient({ chain: { id: 97, name: "BSC Testnet" } as any, transport: http(RPC, { timeout: 10_000 }) });

  console.log(`buying ${url} as EOA ${account.address}`);

  // 1. First contact: expect a 402 with the challenge.
  const res1 = await fetch(url);
  const challenge = await res1.json();
  if (res1.status !== 402) {
    console.log("unexpected response", res1.status, JSON.stringify(challenge).slice(0, 300));
    return;
  }
  const req = challenge.accepts.find((a: any) => a.extra?.assetTransferMethod === "eip3009");
  if (!req) throw new Error("challenge offers no eip3009 rail");
  console.log("challenge:", req.extra.name, req.amount, "->", req.payTo);

  // 2. Build + sign the EIP-3009 TransferWithAuthorization typed data.
  const now = Math.floor(Date.now() / 1000);
  const nonce = keccak256(`0x${Math.random().toString(16).slice(2).padStart(64, "0")}` as Hex) as Hex;
  const message = {
    from: account.address,
    to: req.payTo as Address,
    value: BigInt(req.amount),
    validAfter: 0n,
    validBefore: BigInt(now + 300),
    nonce,
  };
  const signature = await account.signTypedData({
    domain: { name: req.extra.name, version: req.extra.version, chainId: 97, verifyingContract: req.asset as Address },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: message as any,
  });

  // 3. Envelope matching the merchant decoder.
  const envelope = {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:97",
    resource: challenge.resource,
    accepted: req,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: req.payTo,
        value: req.amount,
        validAfter: "0",
        validBefore: String(now + 300),
        nonce,
      },
    },
  };
  const header = Buffer.from(JSON.stringify(envelope)).toString("base64");

  // 4. Retry with payment.
  const res2 = await fetch(url, {
    headers: { "X-PAYMENT": header, "PAYMENT-SIGNATURE": header, "content-type": "application/json" },
  });
  const body = await res2.json();
  console.log("status:", res2.status);
  if (res2.status === 200) {
    console.log("PAID. receipt:", JSON.stringify(body.paid ?? body, null, 2).slice(0, 600));
    console.log("report head:", String(body.report ?? "").slice(0, 400));
  } else {
    console.log("rejected:", JSON.stringify(body).slice(0, 800));
  }
}

main().catch((e) => {
  console.error("buy failed:", e);
  process.exit(1);
});
