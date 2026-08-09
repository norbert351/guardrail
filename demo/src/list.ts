/**
 * GuardRail listing script: grant a fresh scoped session and list the agent
 * on GuardRailMarketplace with the session key's onchain id.
 *
 * The marketplace requires the session key to be LIVE in the Altana KeyStore
 * at listing time (SessionNotLive otherwise), so this proves the full loop:
 * KeyStore session -> marketplace listing -> third-party verifyLive.
 *
 * Usage: tsx src/list.ts
 */

import {
  createClient,
  BNB_TESTNET,
  signerFromPrivateKey,
  type Session,
} from "@altananetwork/sdk";
import {
  createPublicClient,
  http,
  keccak256,
  parseEther,
  encodeFunctionData,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MARKETPLACE: Address = "0x57039e8fea975C7C819Fe03b50c733d38f38387D";
const PANCAKE_ROUTER: Address = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
const WBNB: Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const EXPLORER = "https://testnet.bscscan.com/tx/";

const SPEND_CAP = parseEther("0.02");
const EXPIRY = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

const MARKETPLACE_ABI = [
  {
    name: "list",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "category", type: "uint8" },
      { name: "name", type: "string" },
      { name: "agentWallet", type: "address" },
      { name: "sessionKeyId", type: "bytes32" },
      {
        name: "cap",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "limit", type: "uint256" },
          { name: "period", type: "uint256" },
        ],
      },
      { name: "allowlist", type: "address[]" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "verifyLive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "listingSummary",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "_id", type: "uint256" },
      { name: "category", type: "uint8" },
      { name: "name", type: "string" },
      { name: "agentWallet", type: "address" },
      { name: "sessionKeyId", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "listedAt", type: "uint256" },
    ],
  },
] as const;

function loadAdminKey(): `0x${string}` {
  const stateFile = join(process.cwd(), ".guardrail-state.json");
  if (!existsSync(stateFile)) throw new Error("no .guardrail-state.json, run demo first");
  return JSON.parse(readFileSync(stateFile, "utf8")).adminKey as `0x${string}`;
}

async function main() {
  const adminKey = loadAdminKey();
  const client = createClient({ chains: [BNB_TESTNET] });
  const adminSigner = signerFromPrivateKey(adminKey);
  const account = privateKeyToAccount(adminKey);
  const walletAddress = account.address;

  // Fresh session for the listing (the demo's session was revoked on purpose).
  const wallet = { address: walletAddress };
  const session: Session = await client.grantSession({
    wallet,
    signer: adminSigner,
    permissions: {
      calls: [{ to: PANCAKE_ROUTER }, { to: WBNB }],
      spend: [{ limit: SPEND_CAP, period: "day" }],
    },
    expiry: EXPIRY,
  });
  const keyId = keccak256(session.publicKey);
  console.log("session granted, keyId:", keyId);

  const pubClient = createPublicClient({
    chain: BNB_TESTNET.chain,
    transport: http(BNB_TESTNET.publicRpcUrl),
  });

  const calldata = encodeFunctionData({
    abi: MARKETPLACE_ABI,
    functionName: "list",
    args: [
      1, // Grid Trading
      "GuardRail GridBot",
      walletAddress,
      keyId,
      { token: "0x0000000000000000000000000000000000000000", limit: SPEND_CAP, period: 86400 },
      [PANCAKE_ROUTER, WBNB],
    ],
  });

  const tx = await client.execute({
    wallet,
    signer: adminSigner,
    calls: [{ to: MARKETPLACE, data: calldata }],
  });
  console.log("list tx:", `${EXPLORER}${tx.transactionHash}`);

  // Give the node a moment, then read the listing back.
  await new Promise((r) => setTimeout(r, 4000));
  const id = await pubClient.readContract({
    address: MARKETPLACE,
    abi: MARKETPLACE_ABI,
    functionName: "listingCount",
  }).catch(() => 1n);
  console.log("listingCount:", id.toString());

  const live = await pubClient.readContract({
    address: MARKETPLACE,
    abi: MARKETPLACE_ABI,
    functionName: "verifyLive",
    args: [id],
  });
  console.log("verifyLive(listing):", live);
}

main().catch((e) => {
  console.error("list failed:", e);
  process.exit(1);
});
