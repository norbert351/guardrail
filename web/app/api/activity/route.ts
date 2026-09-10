import { NextResponse } from "next/server";
import { verifyAllActivity } from "@/lib/quality";

export const dynamic = "force-dynamic";

/**
 * GET /api/activity — live onchain activity feed.
 *
 * BSC public RPCs hard-block eth_getLogs (code -32005), so a transparent
 * log-scraper isn't possible on free infra. Instead we derive real, timestamped
 * activity from the onchain proof txs GuardRail actually executed. Each hash is
 * re-fetched on every request (blockNumber + block timestamp + gas), and a hash
 * that stops resolving is DROPPED rather than faked.
 *
 * Source of truth for the hash set: `web/lib/quality.ts#ACTIVITY`, shared with
 * /api/quality so the two views can never disagree.
 */
export async function GET() {
  const verified = await verifyAllActivity();

  const feed = verified
    .filter((v) => v.verified && v.timestamp !== null)
    .map((v) => ({
      kind: v.kind,
      agentName: v.agentName,
      detail: v.detail,
      ts: v.timestamp! * 1000,
      block: String(v.blockNumber),
      gasUsed: v.gasUsed,
      link: v.explorer,
    }))
    .sort((a, b) => b.ts - a.ts);

  return NextResponse.json({
    chainId: 56,
    note: "bounded onchain-proof ledger (BSC public RPC blocks eth_getLogs); every row is a real mainnet tx re-verified at request time",
    verifiedCount: feed.length,
    recordedCount: verified.length,
    feed,
  });
}
