/**
 * GuardRail PROVISION ON MAINNET (chain 56).
 *
 * Grants each of the four agents its own session key in the MAINNET Altana
 * KeyStore via the BNB mainnet relay, and lists it in the newly deployed
 * mainnet GuardRailMarketplace.
 *
 * Reads the same admin key + agent key file as the testnet provisioner but
 * targets BNB mainnet config (BNB, relay.altana.network) and the mainnet
 * marketplace address. This is REAL money: gas on BSC mainnet.
 *
 * Usage: tsx src/provision-agents-mainnet.ts
 */
import { createClient, BNB, signerFromPrivateKey, type Session } from "@altananetwork/sdk";
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

const MARKETPLACE: Address = "0xFB63b0D141eA15E4a3eC33bd2746DA3c4Fe28a80";
const PANCAKE_ROUTER: Address = "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // mainnet router
const WBNB: Address = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"; // mainnet WBNB
const EXPLORER = "https://bscscan.com/tx/";

const EXPIRY = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
const KEYSTORE_MAINNET: Address = "0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a";
const KEYSTORE_ABI = [
  { name: "isValidKey", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "keyId", type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

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

const KEYS_FILE = join(process.cwd(), ".guardrail-agent-keys-mainnet.json");

type AgentKey = { name: string; category: number; sessionPk: Hex; listingId: number };

function loadKeys(): AgentKey[] {
  if (!existsSync(KEYS_FILE)) return [];
  return JSON.parse(readFileSync(KEYS_FILE, "utf8"));
}

function loadAdminKey(): `0x${string}` {
  if (process.env.GUARDRAIL_ADMIN_KEY) return process.env.GUARDRAIL_ADMIN_KEY as `0x${string}`;
  const stateFile = join(process.cwd(), ".guardrail-state.json");
  return JSON.parse(readFileSync(stateFile, "utf8")).adminKey as `0x${string}`;
}

async function main() {
  const adminKey = loadAdminKey();
  const client = createClient({ chains: [BNB] });
  const adminSigner = signerFromPrivateKey(adminKey);
  const account = privateKeyToAccount(adminKey);
  const walletAddress = account.address;
  const wallet = { address: walletAddress };

  const pubClient = createPublicClient({
    chain: BNB.chain,
    transport: http(BNB.publicRpcUrl),
  });

  const keys = loadKeys();
  console.log("MAINNET provisioning. wallet", walletAddress, "marketplace", MARKETPLACE);

  for (const agent of AGENTS) {
    let key = keys.find((k) => k.category === agent.category);
    if (!key) {
      const sessionPk = generatePrivateKey();
      key = { name: agent.name, category: agent.category, sessionPk, listingId: 0 };
      keys.push(key);
    }
    const sessionSigner = signerFromPrivateKey(key.sessionPk);
    const keyId = keccak256(sessionSigner.publicKey as Hex);

    // Idempotent: only register a fresh MAINNET KeyStore session if this key
    // is not already live, so re-running can't revert "key already registered".
    const registered = await pubClient
      .readContract({
        address: KEYSTORE_MAINNET,
        abi: KEYSTORE_ABI,
        functionName: "isValidKey",
        args: [walletAddress, keyId],
      })
      .catch(() => false);
    if (registered) {
      console.log(`\n${agent.name} (cat ${agent.category}): session already live on mainnet, reusing keyId ${keyId.slice(0, 18)}...`);
    } else {
      console.log(`\n${agent.name} (cat ${agent.category}): granting session on MAINNET KeyStore...`);
      await client.grantSession({
        wallet,
        signer: adminSigner,
        sessionSigner,
        permissions: {
          calls: [{ to: PANCAKE_ROUTER }, { to: WBNB }],
          spend: [{ limit: parseEther("0.02"), period: "day" }],
        },
        expiry: EXPIRY,
      });
      console.log(`  session granted, keyId ${keyId.slice(0, 18)}...`);
    }

    const listData = encodeFunctionData({
      abi: MARKETPLACE_ABI,
      functionName: "list",
      args: [
        agent.category,
        agent.name,
        walletAddress,
        keyId,
        { token: "0x0000000000000000000000000000000000000000", limit: parseEther("0.02"), period: 86400n },
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

    const countAfter = await pubClient.readContract({
      address: MARKETPLACE,
      abi: MARKETPLACE_ABI,
      functionName: "listingCount",
    });
    key.listingId = Number(countAfter);
    writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  }

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
    console.log(`cat ${key.category} ${key.name}: listing ${key.listingId}, verifyLive=${live}`);
  }
  console.log(`\nagent keys persisted to ${KEYS_FILE}`);
}

main().catch((e) => {
  console.error("mainnet provisioning failed:", e);
  process.exit(1);
});
