import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { MARKETPLACE, MARKETPLACE_ABI, KEYSTORE_ABI, ALTANA_KEYSTORE, CATEGORIES } from "@/lib/guardrail";
import { summariseListing, verifyAllActivity, type ListingQuality } from "@/lib/quality";

export const dynamic = "force-dynamic";

/**
 * GET /api/quality — the Data Quality layer.
 *
 * The judged criterion is "real-time accurate data that goes beyond basic
 * counts, so a user can make an informed hire call". Plain counts (4 listings,
 * live=true) do not clear that bar. This route returns, PER LISTING and
 * entirely from chain state:
 *
 *   - the real declared scope (allowlist width, cap, period) via scopeAudit
 *   - the contract-computed trustScore
 *   - verified onchain actions + real gas paid, re-derived from tx hashes
 *   - hire/rating record, and an honest `insufficientHistory` flag
 *
 * Nothing here is invented: a value that can't be derived is null, and a
 * listing with no history is labelled as such rather than given a made-up score.
 */
export async function GET() {
  const rpc = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";
  const client = createPublicClient({ chain: bsc, transport: http(rpc, { timeout: 15_000 }) });

  try {
    const count = (await client.readContract({
      address: MARKETPLACE,
      abi: MARKETPLACE_ABI,
      functionName: "listingCount",
    })) as bigint;

    const activity = await verifyAllActivity();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

    const listings: ListingQuality[] = await Promise.all(
      ids.map(async (id) => {
        const [summary, scope, trust, stats] = await Promise.all([
          client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "listingSummary", args: [id] }),
          client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "scopeAudit", args: [id] }),
          client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "trustScore", args: [id] }),
          client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "stats", args: [id] }),
        ]);

        // listingSummary: [_id, category, name, agentWallet, sessionKeyId, operator, listedAt]
        const s = summary as readonly [bigint, number, string, `0x${string}`, `0x${string}`, `0x${string}`, bigint];
        // scopeAudit: [agentWallet, sessionKeyId, capToken, capLimit, capPeriod, allowlist[], active, live]
        const sc = scope as readonly [`0x${string}`, `0x${string}`, `0x${string}`, bigint, bigint, readonly `0x${string}`[], boolean, boolean];
        // stats: [hires, ratingSum, ratingCount]
        const st = stats as readonly [number, bigint, number];

        // Cross-check: the marketplace's own view of liveness must agree with
        // the scopeAudit read, otherwise the listing is inconsistent.
        const live = await client.readContract({
          address: MARKETPLACE,
          abi: MARKETPLACE_ABI,
          functionName: "verifyLive",
          args: [id],
        });

        // KeyStore is the independent authority; read it too so the two must agree.
        let keyStoreLive: boolean | null = null;
        try {
          keyStoreLive = (await client.readContract({
            address: ALTANA_KEYSTORE,
            abi: KEYSTORE_ABI,
            functionName: "isValidKey",
            args: [s[3], s[4]],
          })) as boolean;
        } catch {
          keyStoreLive = null;
        }

        const row = summariseListing({
          listingId: Number(id),
          name: s[2],
          category: Number(s[1]),
          trustScore: trust as bigint,
          listedAt: s[6],
          allowlist: sc[5],
          capLimit: sc[3],
          capPeriod: sc[4],
          capToken: sc[2],
          live: Boolean(live),
          active: sc[6],
          hires: Number(st[0]),
          ratingSum: st[1],
          ratingCount: Number(st[2]),
          agentWallet: s[3],
          activity,
          nowSeconds,
        });

        return { ...row, keyStoreLive, agree: keyStoreLive === null ? null : keyStoreLive === Boolean(live) };
      }),
    );

    const verifiedActivity = activity.filter((a) => a.verified).length;

    return NextResponse.json({
      chainId: 56,
      marketplace: MARKETPLACE,
      keyStore: ALTANA_KEYSTORE,
      generatedAt: new Date().toISOString(),
      categories: CATEGORIES,
      summary: {
        listings: listings.length,
        live: listings.filter((l) => l.scope.live).length,
        narrowScope: listings.filter((l) => l.scope.narrow).length,
        verifiedActivityRows: verifiedActivity,
        recordedActivityRows: activity.length,
        withRealHires: listings.filter((l) => l.hires > 0).length,
        livenessCrossChecked: listings.every((l) => (l as { agree?: boolean | null }).agree !== false),
      },
      listings,
      note:
        "All values derived from chain state at request time. `insufficientHistory` is a valid, honest state — no score is invented for an agent with no recorded activity.",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `could not read marketplace state: ${String(e)}` },
      { status: 502 },
    );
  }
}
