/**
 * GuardRail agent provisioning: give each category agent its OWN session key
 * whose private key is held by the agent process (not lost in an SDK
 * internal). Regrants sessions with explicit agent-held signer keys and
 * relists all four categories with the new key ids.
 *
 * This is what makes the agents real: each one can execute onchain through
 * its own scoped session key, with the private key on disk for the agent
 * process to sign with.
 *
 * Usage: tsx src/provision-agents.ts
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
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKETPLACE: Address = "0x57039e8fea975C7C819Fe03b50c733d38f38387D";
const PANCAKE_ROUTER: Address = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
const WBNB: Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const EXPLORER = "https://testnet.bscscan.com/tx/";

const EXPIRY = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

const AGENTS = [
  { category: 0, name: "GuardRail LP Guardian" },
  { category: 1, name: "GuardRail GridBot" },
  { category: 2, name: "GuardRail Yield Router" },
  { category: 3, name: "GuardRail Health Guard" },
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
    name: "unlist",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    name: "listingCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
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
  {
    name: "verifyLive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

const KEYS_FILE = join(process.cwd(), ".guardrail-agent-keys.json");

type AgentKey = { name: string; category: number; sessionPk: Hex; listingId: number };

function loadKeys(): AgentKey[] {
  if (!existsSync(KEYS_FILE)) return [];
  return JSON.parse(readFileSync(KEYS_FILE, "utf8"));
}

function loadAdminKey(): `0x${string}` {
  const stateFile = join(process.cwd(), ".guardrail-state.json");
  return JSON.parse(readFileSync(stateFile, "utf8")).adminKey as `0x${string}`;
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

  const keys = loadKeys();

  // 1. Build the mapping: category -> current listing id (scan live listings).
  const count = await pubClient.readContract({
    address: MARKETPLACE,
    abi: MARKETPLACE_ABI,
    functionName: "listingCount",
  });
  const listingByCategory = new Map<number, number>();
  for (let i = 1; i <= Number(count); i++) {
    const s = await pubClient
      .readContract({
        address: MARKETPLACE,
        abi: MARKETPLACE_ABI,
        functionName: "listingSummary",
        args: [BigInt(i)],
      })
      .catch(() => null);
    if (!s) continue;
    const cat = Number(s[1]);
    if (cat <= 3 && s[3] === walletAddress) listingByCategory.set(cat, i);
  }
  console.log("current listings by category:", Object.fromEntries(listingByCategory));

  // 2. For each agent: ensure an agent-held session key exists, grant session,
  //    unlist the old listing, list with the new key id.
  for (const agent of AGENTS) {
    let key = keys.find((k) => k.category === agent.category);
    if (!key) {
      const sessionPk = generatePrivateKey();
      key = { name: agent.name, category: agent.category, sessionPk, listingId: 0 };
      keys.push(key);
    }
    const sessionSigner = signerFromPrivateKey(key.sessionPk);

    const session: Session = await client.grantSession({
      wallet,
      signer: adminSigner,
      sessionSigner,
      permissions: {
        calls: [{ to: PANCAKE_ROUTER }, { to: WBNB }],
        spend: [{ limit: parseEther("0.02"), period: "day" }],
      },
      expiry: EXPIRY,
    });
    const keyId = keccak256(session.publicKey);
    console.log(`\n${agent.name} (cat ${agent.category}): session granted, keyId ${keyId.slice(0, 18)}...`);

    // Unlist the old listing for this category if it exists.
    const oldId = listingByCategory.get(agent.category);
    if (oldId !== undefined) {
      const unlistData = encodeFunctionData({
        abi: MARKETPLACE_ABI,
        functionName: "unlist",
        args: [BigInt(oldId)],
      });
      const utx = await client.execute({
        wallet,
        signer: adminSigner,
        calls: [{ to: MARKETPLACE, data: unlistData }],
      });
      console.log(`  unlisted old listing id ${oldId}: ${EXPLORER}${utx.transactionHash}`);
      await new Promise((r) => setTimeout(r, 2500));
    }

    // List with the new key id.
    const listData = encodeFunctionData({
      abi: MARKETPLACE_ABI,
      functionName: "list",
      args: [
        agent.category,
        agent.name,
        walletAddress,
        keyId,
        { token: "0x0000000000000000000000000000000000000000", limit: parseEther("0.02"), period: 86400 },
        [PANCAKE_ROUTER, WBNB],
      ],
    });
    const ltx = await client.execute({
      wallet,
      signer: adminSigner,
      calls: [{ to: MARKETPLACE, data: listData }],
    });
    console.log(`  listed: ${EXPLORER}${ltx.transactionHash}`);
    await new Promise((r) => setTimeout(r, 2500));

    // Find the new listing id.
    const countAfter = await pubClient.readContract({
      address: MARKETPLACE,
      abi: MARKETPLACE_ABI,
      functionName: "listingCount",
    });
    key.listingId = Number(countAfter);
    writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  }

  // 3. Final verification.
  console.log("\n=== final state ===");
  for (const key of keys) {
    const live = await pubClient
      .readContract({
        address: MARKETPLACE,
        abi: MARKETPLACE_ABI,
        functionName: "verifyLive",
        args: [BigInt(key.listingId)],
      })
      .catch(() => false);
    console.log(`cat ${key.category} ${key.name}: listing ${key.listingId}, verifyLive=${live}, sessionPk held by agent`);
  }
  console.log(`\nagent keys persisted to ${KEYS_FILE}`);
}

main().catch((e) => {
  console.error("provisioning failed:", e);
  process.exit(1);
});
