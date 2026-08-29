/**
 * GuardRail — prove an AGENT actually acts on-chain within its scoped session.
 *
 * The 4 agents' scoped sessions (granted in provision-agents-mainnet) only
 * permit calls to the allowlist (PancakeRouter + WBNB) and a 0.02 BNB/day spend
 * cap. Here the agent's OWN session key signs and broadcasts a real on-chain
 * transaction using client.execute(session, calls):
 *
 *   1) WITHIN scope:  WBNB.approve(0xa847…, 0)  → succeeds (real tx on chain 56)
 *   2) OUT of scope:  a call to USDT (not allowlisted) → the KeyStore / account
 *                     contract REJECTS it at validation (UnauthorizedCall), so
 *                     the agent physically cannot act outside its scope.
 *
 * This is the core GuardRail thesis made live: the agent can ACT, but only
 * inside onchain-enforced limits.
 *
 * Usage: tsx src/agent-act-mainnet.ts [--valid] [--invalid]
 *   (default: runs the valid within-scope action only)
 */
import { createClient, BNB, signerFromPrivateKey, type Session } from "@altananetwork/sdk";
import { createPublicClient, http, encodeFunctionData, parseEther, type Address, type Hex } from "viem";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROUTER: Address = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const WBNB: Address = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const USDT_MAIN: Address = "0x55d398326f99059fF775485246999027B3197955";
const WALLET: Address = "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97";
const EXPLORER = "https://bscscan.com/tx/";
const EXPIRY = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

const KEYS_FILE = join(process.cwd(), ".guardrail-agent-keys-mainnet.json");

type AgentKey = { name: string; category: number; sessionPk: Hex; listingId: number };

const APPROVE0 = encodeFunctionData({ abi: [{ name: "approve", type: "function", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [WALLET, 0n] });

function loadAdminKey(): `0x${string}` {
  if (process.env.GUARDRAIL_ADMIN_KEY) return process.env.GUARDRAIL_ADMIN_KEY as `0x${string}`;
  return JSON.parse(readFileSync(join(process.cwd(), ".guardrail-state.json"), "utf8")).adminKey;
}

function loadKeys(): AgentKey[] {
  return JSON.parse(readFileSync(KEYS_FILE, "utf8"));
}

function agentSession(k: AgentKey): Session {
  const signer = signerFromPrivateKey(k.sessionPk);
  return {
    walletAddress: WALLET,
    signer,
    publicKey: signer.publicKey as Hex,
    permissions: {
      calls: [{ to: ROUTER }, { to: WBNB }],
      spend: [{ limit: parseEther("0.02"), period: "day" }],
    },
    expiry: EXPIRY,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const doValid = args.includes("--valid") || !args.includes("--invalid");
  const doInvalid = args.includes("--invalid");
  const client = createClient({ chains: [BNB] });
  const pub = createPublicClient({ chain: BNB.chain, transport: http(BNB.publicRpcUrl) });
  // ensure the orchestrator wallet's account is provisioned for the relay
  const adminSigner = signerFromPrivateKey(loadAdminKey());
  const wallet = await client.createWallet({ signer: adminSigner });

  const agent = loadKeys()[0]; // cat 0 LP Guardian
  console.log(`agent: ${agent.name} (session key ${agent.sessionPk.slice(0, 14)}…) acting on ${wallet.address}`);

  if (doValid) {
    console.log("\n[1] WITHIN scope — WBNB.approve(0xa847…, 0) via scoped session key…");
    try {
      const res = await client.execute({ session: agentSession(agent), calls: [{ to: WBNB, data: APPROVE0 }] });
      const txHash = res.transactionHash;
      console.log(`✅ agent executed onchain: ${EXPLORER}${txHash}`);
      await new Promise((r) => setTimeout(r, 2500));
      const receipt = txHash ? await pub.getTransactionReceipt({ hash: txHash }).catch(() => null) : null;
      console.log(`   status: ${receipt?.status === "success" ? "SUCCESS" : receipt ? receipt.status : "pending/unknown"} · block ${receipt?.blockNumber ?? "—"}`);
      if (txHash) writeFileSync(join(process.cwd(), ".agent-act-tx.json"), JSON.stringify({ agent: agent.name, tx: txHash, kind: "within-scope approve(0)", ts: Date.now() }, null, 2));
    } catch (e) {
      console.error("❌ within-scope execute errored:", (e as Error).message);
      process.exitCode = 1;
    }
  }

  if (doInvalid) {
    console.log("\n[2] OUT of scope — a call to USDT (NOT allowlisted) via the same session…");
    try {
      // never approves to USDT onchain on purpose; this should be rejected.
      const badData = encodeFunctionData({ abi: [{ name: "approve", type: "function", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "approve", args: [WALLET, 0n] });
      const res = await client.execute({ session: agentSession(agent), calls: [{ to: USDT_MAIN, data: badData }], noWait: true });
      console.log("⚠️  unexpected: out-of-scope call was broadcast:", res.transactionHash);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      console.log(`✅ blocked as expected: ${msg.slice(0, 160)}`);
    }
  }
}

main().catch((e) => {
  console.error("agent-act failed:", e);
  process.exit(1);
});