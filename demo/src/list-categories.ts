/**
 * GuardRail category listing script: grant one scoped session per hackathon
 * category and list each agent on GuardRailMarketplace.
 *
 * Sessions are persisted in .guardrail-sessions.json so listings keep the
 * same session key ids across runs (revoking or re-granting would kill
 * verifyLive for already-listed agents). Each category agent has its own
 * session key = its own onchain identity in the Altana KeyStore.
 *
 * Usage: tsx src/list-categories.ts
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
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKETPLACE: Address = "0x57039e8fea975C7C819Fe03b50c733d38f38387D";
const PANCAKE_ROUTER: Address = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
const WBNB: Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const EXPLORER = "https://testnet.bscscan.com/tx/";

const EXPIRY = Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60;

// One agent per hackathon category. Each gets its own spend cap.
const CATEGORY_AGENTS = [
  {
    category: 0,
    name: "GuardRail LP Guardian",
    cap: parseEther("0.02"),
  },
  {
    category: 1,
    name: "GuardRail GridBot",
    cap: parseEther("0.02"),
  },
  {
    category: 2,
    name: "GuardRail Yield Router",
    cap: parseEther("0.02"),
  },
  {
    category: 3,
    name: "GuardRail Health Guard",
    cap: parseEther("0.02"),
  },
] as const;

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
    name: "listingCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "verifyLive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

const SESSION_FILE = join(process.cwd(), ".guardrail-sessions.json");

function loadAdminKey(): `0x${string}` {
  const stateFile = join(process.cwd(), ".guardrail-state.json");
  if (!existsSync(stateFile)) throw new Error("no .guardrail-state.json, run demo first");
  return JSON.parse(readFileSync(stateFile, "utf8")).adminKey as `0x${string}`;
}

type StoredSession = {
  walletAddress: Address;
  publicKey: Hex;
  expiry: number;
  permissions: {
    calls?: { to?: Address; signature?: string }[];
    spend?: { limit: string; period: string; token?: Address }[];
  };
};

function loadSessions(): StoredSession[] {
  if (!existsSync(SESSION_FILE)) return [];
  return JSON.parse(readFileSync(SESSION_FILE, "utf8"));
}

async function main() {
  const adminKey = loadAdminKey();
  const client = createClient({ chains: [BNB_TESTNET] });
  const adminSigner = signerFromPrivateKey(adminKey);
  const account = privateKeyToAccount(adminKey);
  const walletAddress = account.address;
  const wallet = { address: walletAddress };

  const pubClient = createPublicClient({
    chain: BNB_TESTNET.chain,
    transport: http(BNB_TESTNET.publicRpcUrl),
  });

  const existing = loadSessions();
  const sessions: StoredSession[] = [...existing];

  const count = await pubClient.readContract({
    address: MARKETPLACE,
    abi: MARKETPLACE_ABI,
    functionName: "listingCount",
  });
  console.log("existing listings:", count.toString());

  // Grant missing sessions (one per category index).
  for (let i = 0; i < CATEGORY_AGENTS.length; i++) {
    if (sessions[i]) continue;
    console.log(`granting session for category ${i} (${CATEGORY_AGENTS[i].name})...`);
    const session: Session = await client.grantSession({
      wallet,
      signer: adminSigner,
      permissions: {
        calls: [{ to: PANCAKE_ROUTER }, { to: WBNB }],
        spend: [{ limit: CATEGORY_AGENTS[i].cap, period: "day" }],
      },
      expiry: EXPIRY,
    });
    sessions[i] = {
      walletAddress: walletAddress,
      publicKey: session.publicKey,
      expiry: session.expiry,
      permissions: {
        calls: [{ to: PANCAKE_ROUTER }, { to: WBNB }],
        spend: [{ limit: CATEGORY_AGENTS[i].cap.toString(), period: "day" }],
      },
    };
    writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
    console.log(`  session ${i + 1} granted, keyId ${keccak256(session.publicKey).slice(0, 18)}...`);
  }

  // List any category that is not yet on the marketplace.
  for (let i = 0; i < CATEGORY_AGENTS.length; i++) {
    const existingCount = await pubClient.readContract({
      address: MARKETPLACE,
      abi: MARKETPLACE_ABI,
      functionName: "listingCount",
    });
    const desiredId = BigInt(i + 1);
    let live = false;
    try {
      live = await pubClient.readContract({
        address: MARKETPLACE,
        abi: MARKETPLACE_ABI,
        functionName: "verifyLive",
        args: [desiredId],
      });
    } catch {
      live = false;
    }
    if (live) {
      console.log(`category ${i} already listed (id ${desiredId}), verifyLive true, skipping`);
      continue;
    }

    const session = sessions[i];
    if (!session) throw new Error(`no session for category ${i}`);
    const keyId = keccak256(session.publicKey);
    const cap = BigInt(session.permissions.spend![0]!.limit);

    const calldata = encodeFunctionData({
      abi: MARKETPLACE_ABI,
      functionName: "list",
      args: [
        i as 0 | 1 | 2 | 3,
        CATEGORY_AGENTS[i].name,
        walletAddress,
        keyId,
        { token: "0x0000000000000000000000000000000000000000", limit: cap, period: 86400 },
        [PANCAKE_ROUTER, WBNB],
      ],
    });

    const tx = await client.execute({
      wallet,
      signer: adminSigner,
      calls: [{ to: MARKETPLACE, data: calldata }],
    });
    console.log(`listed ${CATEGORY_AGENTS[i].name} (id ${desiredId}): ${EXPLORER}${tx.transactionHash}`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Final state: every category live?
  for (let i = 0; i < CATEGORY_AGENTS.length; i++) {
    const id = BigInt(i + 1);
    const live = await pubClient
      .readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "verifyLive", args: [id] })
      .catch(() => false);
    console.log(`category ${i} (${CATEGORY_AGENTS[i].name}) id ${id}: verifyLive = ${live}`);
  }
}

main().catch((e) => {
  console.error("listing failed:", e);
  process.exit(1);
});
