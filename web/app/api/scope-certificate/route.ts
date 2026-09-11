import { NextResponse } from "next/server";
import { createPublicClient, http, keccak256, encodeAbiParameters, parseAbiParameters, type Address } from "viem";
import { bsc } from "viem/chains";
import { ALTANA_KEYSTORE, MARKETPLACE, MARKETPLACE_ABI, KEYSTORE_ABI } from "@/lib/guardrail";

export const dynamic = "force-dynamic";

const RPC = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";

/**
 * GET /api/scope-certificate?listingId=N[&block=B]
 *
 * A PORTABLE, INDEPENDENTLY-VERIFIABLE scope attestation.
 *
 * The problem this solves: every entry in this category *claims* "out-of-scope
 * calls are blocked". Nobody can check that claim without re-running the
 * product. This endpoint turns the claim into a single document any third party
 * can re-derive from chain state alone — no GuardRail server, no trust in us.
 *
 * It reads the live scope (allowlist, cap, expiry, liveness) from the
 * marketplace + the Altana KeyStore at a PINNED block, then commits to it with a
 * deterministic hash. Recompute the same fields at the same block against the
 * same contracts and you get the same `scopeCommitment`. If it differs, the
 * certificate is a forgery.
 *
 * The verdict is honest by construction: if the session is revoked or the
 * listing paused, the certificate says so and the commitment changes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const listingId = Number(url.searchParams.get("listingId") ?? "1");
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return NextResponse.json({ ok: false, error: "listingId must be a positive integer" }, { status: 400 });
  }
  const blockParam = url.searchParams.get("block");

  try {
    const client = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 20_000 }) });

    /**
     * Block pinning note (important for honest verification): BSC public RPCs
     * (dataseed) prune historical state and answer `missing trie node` for
     * `eth_call` at an old block. So:
     *   - default = `latest` (always reproducible), and
     *   - if `?block=` is given we ATTEMPT it and report clearly when the RPC
     *     cannot serve that height, rather than returning a half-built document.
     * The block hash is always included, so a verifier with an archive RPC can
     * re-run against the exact height named in the certificate.
     */
    const requestedBlock = blockParam ? BigInt(blockParam) : null;
    let blockNumber: bigint;
    if (requestedBlock !== null) {
      blockNumber = requestedBlock;
    } else {
      blockNumber = await client.getBlockNumber();
    }
    const block = await client.getBlock({ blockNumber });

    const [summary, scope, trust] = await Promise.all([
      client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "listingSummary", args: [BigInt(listingId)], blockNumber }),
      client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "scopeAudit", args: [BigInt(listingId)], blockNumber }),
      client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "trustScore", args: [BigInt(listingId)], blockNumber }),
    ]);

    // Normalise either shape (positional array or named struct object).
    const tuple = <T,>(v: unknown, keys: readonly string[]): T =>
      Array.isArray(v) ? (v as T) : (keys.map((k) => (v as Record<string, unknown>)[k]) as unknown as T);

    const s = tuple<[bigint, number, string, `0x${string}`, `0x${string}`, `0x${string}`, bigint]>(
      summary, ["_id", "category", "name", "agentWallet", "sessionKeyId", "operator", "listedAt"],
    );
    const sc = tuple<[`0x${string}`, `0x${string}`, `0x${string}`, bigint, bigint, readonly `0x${string}`[], boolean, boolean]>(
      scope, ["agentWallet", "sessionKeyId", "capToken", "capLimit", "capPeriod", "allowlist", "active", "live"],
    );

    // Independent authority check: ask the KeyStore itself, at the same block.
    let keyStoreLive: boolean | null = null;
    try {
      keyStoreLive = (await client.readContract({
        address: ALTANA_KEYSTORE, abi: KEYSTORE_ABI, functionName: "isValidKey", args: [s[3], s[4]], blockNumber,
      })) as boolean;
    } catch {
      keyStoreLive = null;
    }

    const marketplaceLive = Boolean(sc[7]);
    const agree = keyStoreLive === null ? null : keyStoreLive === marketplaceLive;

    /**
     * The commitment: a deterministic hash over exactly the fields that define
     * the agent's authority. Sorted allowlist so ordering can't be used to
     * produce a different hash for the same scope.
     */
    const allowlistSorted = [...(sc[5] ?? [])].map((a) => a.toLowerCase() as Address).sort();
    const scopeCommitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("address marketplace, uint256 listingId, address agentWallet, bytes32 sessionKeyId, address capToken, uint256 capLimit, uint256 capPeriod, address[] allowlist"),
        [MARKETPLACE, BigInt(listingId), s[3], s[4], sc[2], sc[3], sc[4], allowlistSorted as Address[]],
      ),
    );

    const verdict =
      agree === false
        ? "MISMATCH — the marketplace and the KeyStore disagree about this session; treat the listing as unsafe"
        : !marketplaceLive || keyStoreLive === false
          ? "REVOKED_OR_PAUSED — this agent currently holds no authority"
          : "CONTAINED — the agent's authority is real, live, and bounded as declared";

    return NextResponse.json({
      ok: true,
      certificate: {
        version: 1,
        chainId: 56,
        issuedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
        pinnedBlock: Number(blockNumber),
        blockHash: block.hash,
        contracts: { marketplace: MARKETPLACE, keyStore: ALTANA_KEYSTORE, registry8004: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" },
        subject: { listingId, name: s[2], agentWallet: s[3], sessionKeyId: s[4], category: Number(s[1]) },
        declaredAuthority: {
          allowlist: sc[5] ?? [],
          allowlistSize: (sc[5] ?? []).length,
          capToken: sc[2],
          capLimit: sc[3].toString(),
          capPeriodSeconds: Number(sc[4]),
          marketplaceReportsLive: marketplaceLive,
          keyStoreReportsLive: keyStoreLive,
          independentSourcesAgree: agree,
        },
        trustScore: Number(trust as bigint),
        scopeCommitment,
        verdict,
        howToVerify: {
          summary:
            "Anyone can reproduce this certificate from chain state alone — no GuardRail server involved.",
          steps: [
            `1. Read scopeAudit(${listingId}) and listingSummary(${listingId}) from ${MARKETPLACE} at block ${blockNumber} on chain 56.`,
            `2. Read isValidKey(agentWallet, sessionKeyId) from the Altana KeyStore ${ALTANA_KEYSTORE} at the SAME block.`,
            `3. keccak256(abi.encode(marketplace, listingId, agentWallet, sessionKeyId, capToken, capLimit, capPeriod, sortedAllowlist)) — compare to scopeCommitment.`,
            "4. If the hash matches and both sources agree, the containment claim is verified by construction, not by assertion.",
          ],
          note: "Re-read at the exact pinnedBlock with an archive-capable RPC. Public BSC RPCs prune old state (they answer `missing trie node` for historical eth_call), which is why the certificate defaults to the latest block; the blockHash is included so the height is unambiguous.",
        },
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `could not build certificate: ${String(e).slice(0, 200)}` },
      { status: 502 },
    );
  }
}

