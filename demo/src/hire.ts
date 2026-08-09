/**
 * GuardRail hire flow: a user hires a listed agent through ERC-8183 job
 * escrow in $U, all onchain on BSC testnet.
 *
 * The buyer (this wallet) funds a Job against a provider agent address:
 *   1. hireErc8183Agent() batches createJob + registerJob + setBudget +
 *      approve $U + fund into ONE atomic relay intent.
 *   2. The job is read back: OPEN -> FUNDED.
 *   3. The agent "submits a deliverable" (for the demo the provider is the
 *      same wallet, so we demonstrate the settle path after the window).
 *   4. settleErc8183Job() releases the escrow to the provider.
 *
 * The full job lifecycle is public onchain data. This is the Altana bonus
 * point: hire BNB agents through ERC-8183 using the SDK's buyer side.
 *
 * Usage: tsx src/hire.ts <providerAgentAddress> "<task description>" <budget $U>
 *   e.g. tsx src/hire.ts 0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97 "Rebalance my LP position" 0.1
 */

import {
  createClient,
  BNB_TESTNET,
  signerFromPrivateKey,
  hireErc8183Agent,
  getErc8183Job,
  settleErc8183Job,
  ERC8183_ADDRESSES,
} from "@altananetwork/sdk";
import { createPublicClient, http, parseEther, formatEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXPLORER = "https://testnet.bscscan.com/tx/";
const U_TOKEN: Address = ERC8183_ADDRESSES[97].paymentToken;

function loadAdminKey(): `0x${string}` {
  const stateFile = join(process.cwd(), ".guardrail-state.json");
  if (!existsSync(stateFile)) throw new Error("no .guardrail-state.json, run demo first");
  return JSON.parse(readFileSync(stateFile, "utf8")).adminKey as `0x${string}`;
}

async function main() {
  const provider = (process.argv[2] ?? "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97") as Address;
  const task = process.argv[3] ?? "Audit my Venus position and recommend an action.";
  const budgetU = process.argv[4] ? parseFloat(process.argv[4]) : 0.1;
  const budget = parseEther(budgetU.toFixed(18));

  const adminKey = loadAdminKey();
  const client = createClient({ chains: [BNB_TESTNET] });
  const adminSigner = signerFromPrivateKey(adminKey);
  const account = privateKeyToAccount(adminKey);
  const wallet = { address: account.address };

  const pubClient = createPublicClient({
    chain: BNB_TESTNET.chain,
    transport: http(BNB_TESTNET.publicRpcUrl),
  });

  // Buyer's $U balance check.
  const bal = (await pubClient.readContract({
    address: U_TOKEN,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [wallet.address],
  })) as bigint;
  console.log(`buyer ${wallet.address}`);
  console.log(`$U balance: ${formatEther(bal)}`);
  if (bal < budget) {
    console.log(`need ${formatEther(budget)} $U, have ${formatEther(bal)}. Claim from the $U faucet first.`);
    return;
  }

  // 1. Hire: one atomic intent, five calls batched by the relay.
  console.log(`\nhiring ${provider} for "${task}" at ${budgetU} $U...`);
  const hire = await hireErc8183Agent(wallet, adminSigner, { provider, task, budget }, { network: BNB_TESTNET });
  console.log(`hire tx: ${EXPLORER}${hire.transactionHash}`);
  console.log(`jobId: ${hire.jobId}, budget: ${formatEther(hire.budget)} $U, expiredAt: ${new Date(Number(hire.expiredAt) * 1000).toISOString()}`);

  // 2. Read the job back: should be FUNDED.
  const job = await getErc8183Job(BNB_TESTNET, hire.jobId);
  console.log(`\njob #${job.id} status: ${job.statusName} (client=${job.client}, provider=${job.provider})`);
  if (job.statusName !== "FUNDED") {
    console.log("job did not reach FUNDED, stopping");
    return;
  }

  // 3. Demonstrate the escrow release. In a real flow the provider submits a
  //    deliverable and the buyer settles after the dispute window. For the
  //    demo we settle immediately to show the release path works onchain.
  const settle = await settleErc8183Job(wallet, adminSigner, { jobId: hire.jobId, action: "approve" }, { network: BNB_TESTNET });
  console.log(`\nsettle tx: ${EXPLORER}${settle.transactionHash}`);

  const after = await getErc8183Job(BNB_TESTNET, hire.jobId);
  console.log(`job #${after.id} status after settle: ${after.statusName}`);
  console.log("\nHire flow complete. Escrow lifecycle is public onchain data.");
}

main().catch((e) => {
  console.error("hire failed:", e);
  process.exit(1);
});
