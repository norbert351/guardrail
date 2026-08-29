/**
 * GuardRail: re-list the 4 agents on the NEW v2 MAINNET marketplace directly
 * from the operator EOA (0xa847…). Bypasses the Altana relay (which charges a
 * ~0.0011 BNB fee per op) because the marketplace's list() only requires
 * msg.sender == operator and a live KeyStore session — both hold for a direct
 * EOA call from the operator. Sessions are already live (granted by the earlier
 * mainnet run), so this costs only on-chain gas (~0.00002 BNB per list).
 *
 * Usage: tsx src/list-mainnet-direct.ts
 */
import { createPublicClient, createWalletClient, http, keccak256, parseEther, encodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { signerFromPrivateKey } from "@altananetwork/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKETPLACE: Address = "0xb7c80f5154952E48f6E1548282343000c45b80d6"; // NEW v2 mainnet
const PANCAKE_ROUTER: Address = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const WBNB: Address = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const KEYSTORE_MAINNET: Address = "0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a";
const EXPLORER = "https://bscscan.com/tx/";

const ABI = [
  { name: "list", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "category", type: "uint8" }, { name: "name", type: "string" }, { name: "agentWallet", type: "address" }, { name: "sessionKeyId", type: "bytes32" },
    { name: "cap", type: "tuple", components: [{ name: "token", type: "address" }, { name: "limit", type: "uint256" }, { name: "period", type: "uint256" }] },
    { name: "allowlist", type: "address[]" }], outputs: [{ name: "id", type: "uint256" }] },
  { name: "listingCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "verifyLive", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const KEYS_FILE = join(process.cwd(), ".guardrail-agent-keys-mainnet.json");

function loadState(): `0x${string}` {
  if (process.env.GUARDRAIL_ADMIN_KEY) return process.env.GUARDRAIL_ADMIN_KEY as `0x${string}`;
  return JSON.parse(readFileSync(join(process.cwd(), ".guardrail-state.json"), "utf8")).adminKey;
}

async function main() {
  const adminKey = loadState();
  const account = privateKeyToAccount(adminKey);
  const wallet = account.address;
  const client = createPublicClient({ chain: bsc, transport: http("https://bsc-dataseed.bnbchain.org") });
  const walletClient = createWalletClient({ account, chain: bsc, transport: http("https://bsc-dataseed.bnbchain.org") });

  const keys: { name: string; category: number; sessionPk: Hex; listingId: number }[] = JSON.parse(readFileSync(KEYS_FILE, "utf8"));
  // derive keyId for each live session
  for (const k of keys) {
    const sessionSigner = signerFromPrivateKey(k.sessionPk);
    const keyId = keccak256(sessionSigner.publicKey as Hex);
    const listData = encodeFunctionData({
      abi: ABI, functionName: "list",
      args: [k.category, k.name, wallet, keyId, { token: "0x0000000000000000000000000000000000000000", limit: parseEther("0.02"), period: 86400n }, [PANCAKE_ROUTER, WBNB]],
    });
    console.log(`cat ${k.category} ${k.name}: list() (sendTransaction direct, no relay)...`);
    await client.simulateContract({
      address: MARKETPLACE, abi: ABI, functionName: "list", account: wallet,
      args: [k.category, k.name, wallet, keyId, { token: "0x0000000000000000000000000000000000000000", limit: parseEther("0.02"), period: 86400n }, [PANCAKE_ROUTER, WBNB]],
    }).catch((e) => { throw new Error(`${k.name} list() reverted at simulation: ${e.shortMessage ?? e.message}`); });
    const tx = await walletClient.sendTransaction({ to: MARKETPLACE, data: listData, chain: bsc });
    console.log(`  listed: ${EXPLORER}${tx}`);
    await new Promise((r) => setTimeout(r, 2500));
    const count = await client.readContract({ address: MARKETPLACE, abi: ABI, functionName: "listingCount" });
    k.listingId = Number(count);
    writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  }
  console.log("\n=== final onboard-state ===");
  for (const k of keys) {
    const live = await client.readContract({ address: MARKETPLACE, abi: ABI, functionName: "verifyLive", args: [BigInt(k.listingId)] }).catch(() => false);
    console.log(`cat ${k.category} ${k.name}: listing ${k.listingId}, verifyLive=${live}`);
  }
  console.log("new marketplace:", MARKETPLACE);
}

main().catch((e) => { console.error("failed:", e); process.exit(1); });