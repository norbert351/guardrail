import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import {
  MARKETPLACE,
  MARKETPLACE_ABI,
  KEYSTORE_ABI,
  ALTANA_KEYSTORE,
} from "@/lib/guardrail";

export const dynamic = "force-dynamic";

// Server-side onchain read so the marketplace is not hostage to browser-RPC
// batching quirks. Iterates 1..listingCount, SKIPS ids that were unlisted
// (marketplace reverts NotListed), and returns the genuinely live listings.
// This is still onchain truth — same contract, same RPC, just read in Node.
export async function GET() {
  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(process.env.BNB_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com"),
  });

  try {
    const count = await client.readContract({
      address: MARKETPLACE,
      abi: MARKETPLACE_ABI,
      functionName: "listingCount",
    });

    const N = Number(count);
    const listings = [];

    for (let i = 1; i <= N; i++) {
      // listingSummary reverts NotListed(id) for deleted listings — catch and skip.
      let summary;
      try {
        summary = await client.readContract({
          address: MARKETPLACE,
          abi: MARKETPLACE_ABI,
          functionName: "listingSummary",
          args: [BigInt(i)],
        });
      } catch {
        continue; // unlisted/deleted
      }
      const [id, category, name, agentWallet, sessionKeyId, operator, listedAt] = summary;

      // Best-effort liveness read — it can't revert for a listed id.
      let live = false;
      try {
        live = await client.readContract({
          address: MARKETPLACE,
          abi: MARKETPLACE_ABI,
          functionName: "verifyLive",
          args: [BigInt(i)],
        });
      } catch {
        live = false;
      }

      // allowlist + cap surfaced so users can see exactly what a session may do.
      let allowlist: readonly string[] = [];
      try {
        allowlist = (await client.readContract({
          address: MARKETPLACE,
          abi: [
            {
              name: "allowlistOf",
              type: "function",
              stateMutability: "view",
              inputs: [{ type: "uint256" }],
              outputs: [{ type: "address[]" }],
            },
          ],
          functionName: "allowlistOf",
          args: [BigInt(i)],
        })) as readonly string[];
      } catch {
        /* ignore */
      }

      // Onchain trust score (0-100, computed from liveness + hires + ratings).
      let trustScore = 0;
      try {
        const s = (await client.readContract({
          address: MARKETPLACE,
          abi: MARKETPLACE_ABI,
          functionName: "trustScore",
          args: [BigInt(i)],
        })) as bigint;
        trustScore = Number(s);
      } catch {
        /* ignore */
      }

      // Full scope audit: cap + allowlist + liveness in one honest read.
      let cap: { token?: string; limit?: string; period?: number } = {};
      let active = true;
      try {
        const sc = (await client.readContract({
          address: MARKETPLACE,
          abi: MARKETPLACE_ABI,
          functionName: "scopeAudit",
          args: [BigInt(i)],
        })) as readonly [string, string, string, bigint, bigint, readonly string[], boolean, boolean];
        if (sc[3] > 0n) {
          cap.token = sc[2];
          cap.limit = sc[3].toString();
          cap.period = Number(sc[4]);
        }
        active = sc[6];
        live = sc[7];
      } catch {
        /* ignore */
      }

      listings.push({
        id: Number(id),
        category: Number(category),
        name,
        agentWallet,
        sessionKeyId,
        operator,
        listedAt: Number(listedAt),
        live,
        active,
        allowlist,
        trustScore,
        cap,
      });
    }

    return NextResponse.json({ listingCount: N, live: listings.filter((l) => l.live).length, listings });
  } catch (err) {
    console.error("listing read failed", err);
    return NextResponse.json(
      { error: "failed to read marketplace onchain" },
      { status: 502 }
    );
  }
}
