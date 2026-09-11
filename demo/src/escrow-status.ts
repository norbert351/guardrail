/**
 * Inspect the live ERC-8183 escrow job created by hire-erc8183-mainnet.ts.
 *
 * Reads the job straight from the mainnet AgenticCommerce kernel and reports
 * its real status, budget and timing — no cached values.
 *
 * Usage: tsx src/escrow-status.ts [jobId]
 */

import { createPublicClient, http, formatEther } from "viem";
import { bsc } from "viem/chains";

const RPC = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";
const COMMERCE = "0xEa4DAa3100A767e86FDed867729ae7446476EBA6" as const;
const POLICY = "0x9C01845705b3078Aa2e8cfF7520a6376FD766dE5" as const;

const COMMERCE_ABI = [
  {
    name: "getJob",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
          { name: "submittedAt", type: "uint256" },
          { name: "deliverable", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

const POLICY_ABI = [
  { name: "disputeWindow", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
] as const;

const STATUS = ["OPEN", "FUNDED", "SUBMITTED", "COMPLETED", "REJECTED", "EXPIRED"];

async function main() {
  const jobId = BigInt(process.argv[2] ?? "56774");
  const pub = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 20_000 }) });

  // viem returns a named-tuple object for a struct output (not a positional array).
  const j = (await pub.readContract({
    address: COMMERCE,
    abi: COMMERCE_ABI,
    functionName: "getJob",
    args: [jobId],
  })) as unknown as {
    id: bigint;
    client: `0x${string}`;
    provider: `0x${string}`;
    evaluator: `0x${string}`;
    description: string;
    budget: bigint;
    expiredAt: bigint;
    status: number;
    hook: `0x${string}`;
    submittedAt: bigint;
    deliverable: `0x${string}`;
  };

  const window = (await pub.readContract({
    address: POLICY,
    abi: POLICY_ABI,
    functionName: "disputeWindow",
  })) as bigint;

  const status = STATUS[Number(j.status)] ?? `UNKNOWN(${j.status})`;

  console.log(`ERC-8183 job #${j.id} on BSC mainnet (chain 56)`);
  console.log(`  status      : ${status}`);
  console.log(`  client      : ${j.client}`);
  console.log(`  provider    : ${j.provider}`);
  console.log(`  budget      : ${formatEther(j.budget)} $U (escrowed)`);
  console.log(`  expires at  : ${new Date(Number(j.expiredAt) * 1000).toISOString()}`);
  console.log(`  evaluator   : ${j.evaluator}`);
  console.log(`  submittedAt : ${j.submittedAt === 0n ? "— (provider has not submitted yet)" : new Date(Number(j.submittedAt) * 1000).toISOString()}`);
  console.log(`  dispute win : ${window} s (${Number(window) / 86400} days)`);
  if (Number(j.status) === 1) {
    console.log(
      `\nThe escrow is HELD onchain. Settlement is blocked by protocol design until` +
        `\nthe provider submits a deliverable and the ${Number(window) / 86400}-day optimistic` +
        `\ndispute window elapses — an early settle() reverts NotDecided() (0x17be5b7b).`,
    );
  }
  if (Number(j.status) === 0) {
    console.log(`\nJob open, awaiting funding.`);
  }
}

main().catch((e) => {
  console.error("escrow status failed:", String((e as Error)?.message ?? e).slice(0, 400));
  process.exit(1);
});
