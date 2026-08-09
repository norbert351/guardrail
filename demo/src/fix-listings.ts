/**
 * GuardRail fix: list the missing Rebalancing agent (LP Guardian) and unlist
 * the duplicate GridBot at id 2 from the earlier run.
 *
 * The list-categories skip logic assumed id N = category N-1, but id 1 was
 * GridBot (category 1) from the first listing, so Rebalancing was skipped.
 * This lists category 0 with its granted session, then removes the duplicate.
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
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MARKETPLACE: Address = "0x57039e8fea975C7C819Fe03b50c733d38f38387D";
const PANCAKE_ROUTER: Address = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
const WBNB: Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const EXPLORER = "https://testnet.bscscan.com/tx/";

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
    name: "verifyLive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

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

  // Session 0 (LP Guardian / Rebalancing) from .guardrail-sessions.json.
  const sessionFile = join(process.cwd(), ".guardrail-sessions.json");
  const sessions: { publicKey: Hex; permissions: { spend?: { limit: string }[] } }[] =
    JSON.parse(readFileSync(sessionFile, "utf8"));
  const session = sessions[0]!;
  const keyId = keccak256(session.publicKey);
  const cap = BigInt(session.permissions.spend![0]!.limit);

  // 1. List LP Guardian as category 0 (Rebalancing).
  const listCalldata = encodeFunctionData({
    abi: MARKETPLACE_ABI,
    functionName: "list",
    args: [
      0,
      "GuardRail LP Guardian",
      walletAddress,
      keyId,
      { token: "0x0000000000000000000000000000000000000000", limit: cap, period: 86400 },
      [PANCAKE_ROUTER, WBNB],
    ],
  });
  const listTx = await client.execute({
    wallet,
    signer: adminSigner,
    calls: [{ to: MARKETPLACE, data: listCalldata }],
  });
  console.log(`listed LP Guardian: ${EXPLORER}${listTx.transactionHash}`);
  await new Promise((r) => setTimeout(r, 3000));

  // 2. Unlist the duplicate GridBot at id 2.
  const unlistCalldata = encodeFunctionData({
    abi: MARKETPLACE_ABI,
    functionName: "unlist",
    args: [2n],
  });
  const unlistTx = await client.execute({
    wallet,
    signer: adminSigner,
    calls: [{ to: MARKETPLACE, data: unlistCalldata }],
  });
  console.log(`unlisted duplicate GridBot id 2: ${EXPLORER}${unlistTx.transactionHash}`);
  await new Promise((r) => setTimeout(r, 3000));

  // 3. Final state.
  const count = await pubClient.readContract({
    address: MARKETPLACE,
    abi: MARKETPLACE_ABI,
    functionName: "listingCount",
  });
  console.log("listingCount:", count.toString());
  for (let i = 1; i <= Number(count); i++) {
    const live = await pubClient
      .readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "verifyLive", args: [BigInt(i)] })
      .catch(() => false);
    console.log(`id ${i}: verifyLive = ${live}`);
  }
}

main().catch((e) => {
  console.error("fix failed:", e);
  process.exit(1);
});
