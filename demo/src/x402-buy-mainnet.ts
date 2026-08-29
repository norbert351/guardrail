/**
 * GuardRail x402 EOA buyer — MAINNET variant (chain 56, mainnet $U).
 * Signs EIP-3009 TransferWithAuthorization with the raw EOA key and emits the
 * envelope the mainnet merchant decodes, settling on BSC mainnet.
 * Usage: tsx src/x402-buy-mainnet.ts http://127.0.0.1:8788/v1/agents/health
 */
import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const U_TOKEN = "0xcE24439F2D9C6a2289F741120FE202248B666666" as Address;
const RPC = "https://bsc-dataseed.bnbchain.org";
const CHAIN_ID = 56;

function loadAdminKey(): `0x${string}` {
  if (process.env.GUARDRAIL_ADMIN_KEY) return process.env.GUARDRAIL_ADMIN_KEY as `0x${string}`;
  const f = join(process.cwd(), ".guardrail-state.json");
  if (!existsSync(f)) throw new Error("no .guardrail-state.json (set GUARDRAIL_ADMIN_KEY)");
  return JSON.parse(readFileSync(f, "utf8")).adminKey as `0x${string}`;
}

async function main() {
  const url = process.argv[2] ?? "http://127.0.0.1:8788/v1/agents/health";
  const account = privateKeyToAccount(loadAdminKey());
  const pubClient = createPublicClient({ chain: { id: CHAIN_ID, name: "BSC" } as any, transport: http(RPC, { timeout: 10_000 }) });

  console.log(`buying ${url} as EOA ${account.address} (mainnet chain 56)`);

  const res1 = await fetch(url);
  const challenge = await res1.json();
  if (res1.status !== 402) {
    console.log("unexpected response", res1.status, JSON.stringify(challenge).slice(0, 300));
    return;
  }
  const req = challenge.accepts.find((a: any) => a.extra?.assetTransferMethod === "eip3009");
  if (!req) throw new Error("challenge offers no eip3009 rail");
  console.log("challenge:", req.extra.name, req.amount, "->", req.payTo);

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
    domain: { name: req.extra.name, version: req.extra.version, chainId: CHAIN_ID, verifyingContract: req.asset as Address },
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

  const envelope = {
    x402Version: 2,
    scheme: "exact",
    network: `eip155:${CHAIN_ID}`,
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