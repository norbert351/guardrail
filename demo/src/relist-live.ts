/**
 * GuardRail relist onto the upgraded marketplace.
 *
 * The marketplace contract was upgraded (new address, new onchain
 * trustScore() + scopeAudit()). The four GuardRail agents already hold LIVE
 * sessions in the Altana KeyStore (agent-held private keys in
 * .guardrail-agent-keys.json). This script lists those EXISTING live sessions
 * on the new contract — no new session grants, no relisting of stale keys —
 * which is exactly the "listing is free" path any third party takes: bring a
 * live KeyStore session, list it for free, it inherits GuardRail's scoped
 * enforcement and gets an onchain trust score.
 *
 * Usage: tsx src/relist-live.ts
 */
import {
  createClient,
  BNB_TESTNET,
  signerFromPrivateKey,
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

const MARKETPLACE: Address = "0x0e111C58E488fE3647F0b45011Ba7334d163E566";
const PANCAKE_ROUTER: Address = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
const WBNB: Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const EXPLORER = "https://testnet.bscscan.com/tx/";
const SPEND_CAP = parseEther("0.02");

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

type AgentKey = { name: string; category: number; sessionPk: Hex; listingId: number };

function loadAdminKey(): `0x${string}` {
  const f = join(process.cwd(), ".guardrail-state.json");
  return JSON.parse(readFileSync(f, "utf8")).adminKey as `0x${string}`;
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

  const keysFile = join(process.cwd(), ".guardrail-agent-keys.json");
  const keys: AgentKey[] = JSON.parse(readFileSync(keysFile, "utf8"));

  console.log("relisting live sessions on:", MARKETPLACE);

  for (const key of keys) {
    // Rebuild the agent's live session from its held private key.
    const signer = signerFromPrivateKey(key.sessionPk);
    const keyId = keccak256(signer.publicKey as Hex);

    const listed = await pubClient
      .readContract({
        address: MARKETPLACE,
        abi: MARKETPLACE_ABI,
        functionName: "listingCount",
      })
      .catch(() => 0n);
    // Fresh contract, sequential ids.
    const desiredId = listed + 1n;

    // Skip if this exact key id is already live on the new contract.
    try {
      const live = (await pubClient.readContract({
        address: MARKETPLACE,
        abi: MARKETPLACE_ABI,
        functionName: "verifyLive",
        args: [desiredId],
      })) as boolean;
      if (live) {
        console.log(`${key.name} (cat ${key.category}) already live at id ${desiredId}, skipping`);
        key.listingId = Number(desiredId);
        continue;
      }
    } catch {
      /* not listed yet */
    }

    const calldata = encodeFunctionData({
      abi: MARKETPLACE_ABI,
      functionName: "list",
      args: [
        key.category,
        key.name,
        walletAddress,
        keyId,
        { token: "0x0000000000000000000000000000000000000000", limit: SPEND_CAP, period: 86400n },
        [PANCAKE_ROUTER, WBNB],
      ],
    });

    const tx = await client.execute({
      wallet,
      signer: adminSigner,
      calls: [{ to: MARKETPLACE, data: calldata }],
    });
    console.log(`${key.name} (cat ${key.category}) listed: ${EXPLORER}${tx.transactionHash}`);
    key.listingId = Number(desiredId);
    writeFileSync(keysFile, JSON.stringify(keys, null, 2));
    await new Promise((r) => setTimeout(r, 2500));
  }

  console.log("\n=== final state on new marketplace ===");
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
}

main().catch((e) => {
  console.error("relist failed:", e);
  process.exit(1);
});