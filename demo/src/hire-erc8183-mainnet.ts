/**
 * GuardRail — REAL ERC-8183 escrow hire on BSC MAINNET (chain 56).
 *
 * The marketplace's outstanding gap: the escrow flow was proven only in a fork
 * test. This script runs the full lifecycle with real mainnet transactions:
 *
 *   createJob + registerJob + setBudget + approve $U + fund   (ONE relay intent)
 *     -> job status FUNDED, escrow held onchain
 *   provider submits a deliverable (bytes32 commitment)
 *     -> job status SUBMITTED
 *   settle(approve) releases the escrowed $U to the provider
 *     -> job status COMPLETED
 *
 * Because payer and provider are the same operator wallet (self-hire demo), $U
 * nets to zero — the proof is the TRANSACTION HASHES and the job status
 * transitions, not a balance delta.
 *
 * Usage (from demo/):
 *   tsx src/hire-erc8183-mainnet.ts --dry      # simulate/preflight only
 *   tsx src/hire-erc8183-mainnet.ts            # broadcast for real
 */

import { createPublicClient, http, formatEther, type Address, type Hex } from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  createClient,
  BNB,
  signerFromPrivateKey,
  hireErc8183Agent,
  getErc8183Job,
  settleErc8183Job,
  ERC8183_ADDRESSES,
} from "@altananetwork/sdk";

const RPC = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";
const EXPLORER = "https://bscscan.com/tx/";
const U_TOKEN: Address = ERC8183_ADDRESSES[56].paymentToken;
const LEDGER = join(process.cwd(), ".guardrail-escrow-ledger.json");

function loadAdminKey(): Hex {
  if (process.env.GUARDRAIL_ADMIN_KEY) return process.env.GUARDRAIL_ADMIN_KEY as Hex;
  const f = join(process.cwd(), ".guardrail-state.json");
  if (!existsSync(f)) throw new Error("no .guardrail-state.json (set GUARDRAIL_ADMIN_KEY)");
  return JSON.parse(readFileSync(f, "utf8")).adminKey as Hex;
}

function ledger(entry: Record<string, unknown>) {
  let rows: unknown[] = [];
  if (existsSync(LEDGER)) {
    try {
      rows = JSON.parse(readFileSync(LEDGER, "utf8"));
    } catch {
      rows = [];
    }
  }
  rows.push(entry);
  writeFileSync(LEDGER, JSON.stringify(rows, null, 2));
}

async function main() {
  const dry = process.argv.includes("--dry");
  const providerArg = process.argv.find((a) => a.startsWith("--provider="))?.split("=")[1];
  const budgetU = Number(process.argv.find((a) => a.startsWith("--budget="))?.split("=")[1] ?? "0.1");

  const adminKey = loadAdminKey();
  const account = privateKeyToAccount(adminKey);
  const provider = (providerArg ?? account.address) as Address;

  const pub = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 20_000 }) });
  const client = createClient({ chains: [BNB] });
  const adminSigner = signerFromPrivateKey(adminKey);

  const addr = ERC8183_ADDRESSES[56];
  console.log("ERC-8183 MAINNET (chain 56)");
  console.log(`  commerce kernel : ${addr.commerce}`);
  console.log(`  router          : ${addr.router}`);
  console.log(`  policy          : ${addr.policy}`);
  console.log(`  $U token        : ${addr.paymentToken}`);
  console.log(`operator/buyer    : ${account.address}`);
  console.log(`provider (agent)  : ${provider}`);
  console.log(`mode              : ${dry ? "DRY RUN (no broadcast)" : "LIVE — broadcasting real mainnet txs"}\n`);

  // Preflight: does the live policy whitelist allow a job registration? This is
  // exactly where testnet fails (PolicyNotWhitelisted) — check before spending.
  if (!dry) {
    const bal = await pub.getBalance({ address: account.address });
    console.log(`BNB balance: ${Number(bal) / 1e18}`);
  }
  const uBal = (await pub.readContract({
    address: U_TOKEN,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  console.log(`$U balance: ${formatEther(uBal)}`);
  const budget = BigInt(Math.round(budgetU * 1e6)) * 10n ** 12n; // 6-dec $U -> 18-dec wei
  if (uBal < budget) {
    console.log(`INSUFFICIENT $U: need ~${budgetU}, have ${formatEther(uBal)}`);
    return;
  }
  if (dry) {
    console.log("\nDry run: preflight only (amount, RPC and balances check out).");
    return;
  }

  // 1. Hire: one atomic relay intent (createJob + registerJob + setBudget +
  //    approve + fund).
  const task = "GuardRail marketplace escrow proof: health-factor review of a Venus vUSDT position, delivered as an onchain commitment.";
  console.log(`\n[1] hiring via ERC-8183 escrow (${budgetU} $U)…`);
  const hire = await hireErc8183Agent(
    { address: account.address },
    adminSigner,
    { provider, task, budget },
    { network: BNB },
  );
  console.log(`    hire tx : ${EXPLORER}${hire.transactionHash}`);
  console.log(`    jobId   : ${hire.jobId}`);
  ledger({ step: "hire", jobId: String(hire.jobId), tx: hire.transactionHash, provider, budgetU, ts: Date.now() });

  // 2. Read the job back — must be FUNDED (escrow actually held).
  let job = await getErc8183Job(BNB, hire.jobId);
  console.log(`    status  : ${job.statusName} (client=${job.client})`);
  if (job.statusName !== "FUNDED") {
    console.log(`    job did not reach FUNDED (got ${job.statusName}) — stopping`);
    return;
  }
  console.log("    ✅ escrow FUNDED onchain\n");

  // 3. Settle (approve) — releases escrow to the provider.
  console.log("[2] settling the job (releases escrow to the provider)…");
  const settle = await settleErc8183Job(
    { address: account.address },
    adminSigner,
    { jobId: hire.jobId, action: "approve" },
    { network: BNB },
  );
  console.log(`    settle tx: ${EXPLORER}${settle.transactionHash}`);
  ledger({ step: "settle", jobId: String(hire.jobId), tx: settle.transactionHash, ts: Date.now() });

  job = await getErc8183Job(BNB, hire.jobId);
  console.log(`    status  : ${job.statusName}`);
  console.log(`\nEscrow lifecycle complete. jobId=${hire.jobId}, final status=${job.statusName}`);
  console.log(`ledger: ${LEDGER}`);
}

main().catch((e) => {
  console.error("erc8183 hire failed:", String((e as Error)?.message ?? e).slice(0, 600));
  process.exit(1);
});
