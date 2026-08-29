import { NextResponse } from "next/server";
import { createPublicClient, http, type Address, type Hash } from "viem";
import { bsc } from "viem/chains";

export const dynamic = "force-dynamic";

/**
 * GET /api/activity  — live onchain activity feed.
 *
 * BSC public RPCs hard-block eth_getLogs (code -32005) and archive receipt
 * reads, so a transparent log-scraper isn't possible on free infra. Instead we
 * derive real, timestamped activity from the on-chain proof tx's GuardRail has
 * actually executed (each fetched live: blockNumber + block timestamp):
 *   - marketplace deploy (v2 mainnet)
 *   - the 4 agent listings
 *   - paid-report sale settled via x402 (mainnet $U, EIP-3009)
 *   - the agent's real scoped-session on-chain action (within allowlist)
 * Every row links to a verifiable BscScan transaction.
 */

type Proof = { kind: string; agentName: string; detail: string; txHash: Hash };

const PROOFS: Proof[] = [
  { kind: "listed", agentName: "GuardRail LP Guardian", detail: "listed #1 on the v2 mainnet marketplace", txHash: "0x3aaa6beb00ece8fd6f82512945bfa586268c7ec3e7223939d46aefb1d0f3c6e3" },
  { kind: "listed", agentName: "GuardRail GridBot", detail: "listed #2 on the v2 mainnet marketplace", txHash: "0x9430a9a527baae370a22fbe4d961c5020cee9072fbe1ba35ef0a6b135c9c0519" },
  { kind: "listed", agentName: "GuardRail Yield Router", detail: "listed #3 on the v2 mainnet marketplace", txHash: "0xfc0234ab1687d0e009a887947a88fc4e2ee1363f6d7c378ca49a569a54bfffa5" },
  { kind: "listed", agentName: "GuardRail Health Guard", detail: "listed #4 on the v2 mainnet marketplace", txHash: "0xcc7ec528ed6e0bd61915c633a9ce62e659eab5f04e2188cd0cce7b8b15056805" },
  { kind: "paid", agentName: "GuardRail marketplace", detail: "paid report settled on mainnet $U (x402, EIP-3009)", txHash: "0x3469fdd04959b5cb71d8a4aa48c0b7f50ca6f600124b33624afb9fa2cd533ed6" },
  { kind: "agent-act", agentName: "GuardRail LP Guardian", detail: "agent executed on-chain within its scoped session (WBNB approve, allowlisted)", txHash: "0x2d022320c99f7424dcea33b1c72ad070262fd511f98bcfb935530eff760b43bb" },
  { kind: "deployed", agentName: "GuardRail v2 marketplace", detail: "deployed to BSC mainnet (KeyStore-bound)", txHash: "0xbf3dd81865de1f9d556b8078db77f0c0f356346d0587dd1e98c3400ff592863f" },
];

export async function GET() {
  const rpc = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";
  const client = createPublicClient({ chain: bsc, transport: http(rpc, { timeout: 15_000 }) });

  const rows = await Promise.all(
    PROOFS.map(async (p) => {
      try {
        const tx = await client.getTransaction({ hash: p.txHash });
        const blk = await client.getBlock({ blockNumber: tx.blockNumber });
        return {
          kind: p.kind,
          agentName: p.agentName,
          detail: p.detail,
          ts: Number(blk.timestamp) * 1000,
          block: String(tx.blockNumber),
          link: `https://bscscan.com/tx/${p.txHash}`,
        };
      } catch {
        return null; // fetch failed — drop the row rather than fake it
      }
    })
  );

  const feed = rows.filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => b.ts - a.ts);

  return NextResponse.json({ chainId: 56, note: "bounded onchain-proof ledger (BSC public RPC blocks eth_getLogs)", feed });
}