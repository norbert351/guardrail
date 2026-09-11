/**
 * GuardRail ERC-8004 agent identity registration — BSC MAINNET (chain 56).
 *
 * Registers each GuardRail agent as an onchain ERC-8004 identity on the MAINNET
 * IdentityRegistry. The registration mints an agent NFT whose tokenURI is an
 * EIP-8004 registration-v1 JSON document carrying the agent's name, description
 * and its live x402/A2A endpoints — so the agent is discoverable by any
 * ERC-8004 indexer independently of GuardRail's own marketplace UI.
 *
 * IMPORTANT (why this script exists): the previous version was testnet-only and
 * the web UI hardcoded ids 1790–1793, which are owned by FOUR OTHER teams on
 * mainnet. Claiming them was a verifiable false claim. This script registers the
 * real identities and prints the true ids to use.
 *
 * Usage (from demo/):
 *   tsx src/register-8004-mainnet.ts --check     # read-only: are our ids set?
 *   tsx src/register-8004-mainnet.ts             # register any missing agent
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import { bsc } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"; // MAINNET IdentityRegistry
const RPC = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";
const EXPLORER = "https://bscscan.com/tx/";
const MERCHANT = process.env.GUARDRAIL_MERCHANT_URL ?? "https://guardrail-ohky.onrender.com";
const IDS_FILE = join(process.cwd(), ".guardrail-8004-mainnet.json");

const AGENTS = [
  { key: "lp", name: "GuardRail LP Guardian", category: "Rebalancing", desc: "Manages PancakeSwap LP ranges and resets positions when the ratio drifts outside a band. Operates inside an Altana scoped session (allowlist + spend cap + expiry)." },
  { key: "grid", name: "GuardRail GridBot", category: "Grid Trading", desc: "Runs a bounded grid strategy on WBNB/USDT, firing scoped swaps at grid levels. Operates inside an Altana scoped session (allowlist + spend cap + expiry)." },
  { key: "yield", name: "GuardRail Yield Router", category: "Yield Optimisation", desc: "Compares live APRs across markets and routes liquidity to the best one. Operates inside an Altana scoped session (allowlist + spend cap + expiry)." },
  { key: "health", name: "GuardRail Health Guard", category: "Health Factor Monitoring", desc: "Watches Venus lending positions and protects them from liquidation. Operates inside an Altana scoped session (allowlist + spend cap + expiry)." },
] as const;

const REGISTER_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

const REGISTERED_EVENT = {
  type: "event",
  name: "Registered",
  inputs: [
    { name: "agentId", type: "uint256", indexed: true },
    { name: "agentURI", type: "string", indexed: false },
    { name: "owner", type: "address", indexed: true },
  ],
} as const;

function loadAdminKey(): Hex {
  if (process.env.GUARDRAIL_ADMIN_KEY) return process.env.GUARDRAIL_ADMIN_KEY as Hex;
  const f = join(process.cwd(), ".guardrail-state.json");
  if (!existsSync(f)) throw new Error("no .guardrail-state.json (set GUARDRAIL_ADMIN_KEY)");
  return JSON.parse(readFileSync(f, "utf8")).adminKey as Hex;
}

function readIds(): Record<string, number> {
  if (!existsSync(IDS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(IDS_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** EIP-8004 registration-v1 document as a base64 data URI. */
function agentUri(a: (typeof AGENTS)[number]): string {
  const doc = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: a.name,
    description: a.desc,
    image: "https://guardrail-delta.vercel.app/og.png",
    services: [
      { name: "web", endpoint: "https://guardrail-delta.vercel.app/agents" },
      { name: "x402", endpoint: `${MERCHANT}/v1/agents/${a.key}`, version: "0.1.0" },
    ],
    x402Support: true,
    active: true,
    // GuardRail-specific: the agent's authority is a scoped Altana session,
    // verifiable onchain by anyone.
    guardrail: {
      marketplace: "0xb7c80f5154952E48f6E1548282343000c45b80d6",
      chainId: 56,
      scopeModel: "altana-scoped-session",
      verify: "marketplace.verifyLive(agentId) + scopeAudit(agentId)",
    },
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(doc)).toString("base64")}`;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const account = privateKeyToAccount(loadAdminKey());
  const pub = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 20_000 }) });
  const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC, { timeout: 20_000 }) });

  console.log(`ERC-8004 MAINNET registry ${REGISTRY}`);
  console.log(`owner wallet          ${account.address}`);
  console.log(`merchant (x402 svc)   ${MERCHANT}\n`);

  const ids = readIds();

  for (const a of AGENTS) {
    const known = ids[a.key];
    if (known) {
      const owner = await pub
        .readContract({ address: REGISTRY, abi: REGISTER_ABI, functionName: "ownerOf", args: [BigInt(known)] })
        .catch(() => null);
      const ours = owner && owner.toLowerCase() === account.address.toLowerCase();
      console.log(`  ${a.name}: id ${known} owner=${owner ?? "?"} ${ours ? "✅ ours" : "❌ NOT ours"}`);
      continue;
    }
    if (checkOnly) {
      console.log(`  ${a.name}: not registered yet (run without --check)`);
      continue;
    }
    try {
      const hash = await wallet.writeContract({
        address: REGISTRY,
        abi: REGISTER_ABI,
        functionName: "register",
        args: [agentUri(a)],
      });
      console.log(`  ${a.name}: register tx ${EXPLORER}${hash}`);
      const rcpt = await pub.waitForTransactionReceipt({ hash });
      let newId: number | null = null;
      for (const log of rcpt.logs) {
        try {
          const d = decodeEventLog({ abi: [REGISTERED_EVENT], data: log.data, topics: log.topics });
          if (d.eventName === "Registered") newId = Number((d.args as { agentId: bigint }).agentId);
        } catch {
          /* not our event */
        }
      }
      if (newId === null) {
        console.log(`    (no Registered event decoded; check tx manually)`);
        continue;
      }
      ids[a.key] = newId;
      writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2));
      console.log(`    ✅ agentId ${newId} (status ${rcpt.status})`);
    } catch (e) {
      console.log(`    ❌ failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    }
  }

  console.log(`\nids file: ${IDS_FILE}`);
  console.log(JSON.stringify(ids, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
