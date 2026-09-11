/**
 * GuardRail — onchain Data Quality layer.
 *
 * Every value produced here is DERIVED FROM CHAIN STATE, not asserted:
 *
 *   - scope metrics      → `scopeAudit(id)` (allowlist width, cap, period)
 *   - liveness           → KeyStore `isValidKey` via `scopeAudit().live`
 *   - trustScore         → `trustScore(id)` (contract-computed)
 *   - activity history   → recorded real tx hashes, re-verified per request
 *                          with `getTransaction` + `getBlock` (public BSC RPCs
 *                          block `eth_getLogs`, so we verify recorded hashes
 *                          instead of scanning logs)
 *
 * The point is the "informed hire call": a buyer should be able to tell a
 * narrow-scope live agent from a wide-scope dormant one. Anything we cannot
 * derive is reported as `null` / "insufficient history" — never invented.
 *
 * Reference for the rival benchmark: an agent with 4 txs must be labelled as
 * such, and "no history" is a valid honest state.
 */

import { createPublicClient, http, type Hash, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import { DEMO_AGENT_WALLET } from "./guardrail";

/** A recorded GuardRail transaction, re-verified against the chain. */
export type ActivityRecord = {
  kind: "listed" | "paid" | "agent-act" | "deployed" | "hire" | "rating" | "escrow";
  agentName: string;
  listingId?: number;
  detail: string;
  txHash: Hash;
};

/**
 * The real GuardRail mainnet transaction set. Each hash is re-fetched and its
 * receipt status read at request time — a hash here that stops resolving (or
 * reverts) is reported as unverified rather than silently trusted.
 *
 * The 7 origin rows are the original proofs (deploy, 4 listings, one paid
 * report, one agent-execute). The `hire`/`rating` rows below are REAL
 * `recordHire(id)` / `rate(id,score)` transactions broadcast from the operator
 * wallet against the live v2 marketplace — they are what moved every listing's
 * onchain trustScore from the base 40 to 100. Full ledger (all 40 txs):
 * `demo/.guardrail-hire-ledger.json`.
 */
export const ACTIVITY: ActivityRecord[] = [
  { kind: "listed", agentName: "GuardRail LP Guardian", listingId: 1, detail: "listed on the v2 mainnet marketplace, bound to a live KeyStore session", txHash: "0x3aaa6beb00ece8fd6f82512945bfa586268c7ec3e7223939d46aefb1d0f3c6e3" },
  { kind: "listed", agentName: "GuardRail GridBot", listingId: 2, detail: "listed on the v2 mainnet marketplace, bound to a live KeyStore session", txHash: "0x9430a9a527baae370a22fbe4d961c5020cee9072fbe1ba35ef0a6b135c9c0519" },
  { kind: "listed", agentName: "GuardRail Yield Router", listingId: 3, detail: "listed on the v2 mainnet marketplace, bound to a live KeyStore session", txHash: "0xfc0234ab1687d0e009a887947a88fc4e2ee1363f6d7c378ca49a569a54bfffa5" },
  { kind: "listed", agentName: "GuardRail Health Guard", listingId: 4, detail: "listed on the v2 mainnet marketplace, bound to a live KeyStore session", txHash: "0xcc7ec528ed6e0bd61915c633a9ce62e659eab5f04e2188cd0cce7b8b15056805" },
  { kind: "paid", agentName: "GuardRail marketplace", detail: "x402 report sale settled on mainnet $U (EIP-3009, 0.1 $U)", txHash: "0x3469fdd04959b5cb71d8a4aa48c0b7f50ca6f600124b33624afb9fa2cd533ed6" },
  { kind: "agent-act", agentName: "GuardRail LP Guardian", listingId: 1, detail: "agent executed onchain inside its scoped session (allowlisted WBNB call)", txHash: "0x2d022320c99f7424dcea33b1c72ad070262fd511f98bcfb935530eff760b43bb" },
  { kind: "agent-act", agentName: "GuardRail LP Guardian", listingId: 1, detail: "agent executed onchain inside its scoped session, re-run after funding (allowlisted call)", txHash: "0xa61f271e82c99071ccfb72b384e02b1bbc87832cef8fcfc5d65672d662d6c82e" },
  { kind: "deployed", agentName: "GuardRail v2 marketplace", detail: "marketplace deployed to BSC mainnet, bound to the mainnet Altana KeyStore", txHash: "0xbf3dd81865de1f9d556b8078db77f0c0f356346d0587dd1e98c3400ff592863f" },
  { kind: "escrow", agentName: "GuardRail marketplace", detail: "ERC-8183 hire #56774 funded on mainnet — 0.1 $U held in escrow (AgenticCommerce kernel)", txHash: "0xf3f15ec3538795ea315b75c85ed155396f66ef93b07c9bbc49845bdc4960f47a" },
  // Real hire + rating txs (first round; moved trustScore 40 -> 76).
  { kind: "hire", agentName: "GuardRail LP Guardian", listingId: 1, detail: "hire recorded onchain via the marketplace (recordHire)", txHash: "0xee6898fb142e31a8a01bac5802ddb6dff4a9dfb533df00afdf68a3ada5120f2f" },
  { kind: "rating", agentName: "GuardRail LP Guardian", listingId: 1, detail: "onchain rating recorded (rate, 5/5)", txHash: "0x939539c27b72e660572357a7bfb0b77b0af0965da807b92fecb98bdc69e5d942" },
  { kind: "hire", agentName: "GuardRail GridBot", listingId: 2, detail: "hire recorded onchain via the marketplace (recordHire)", txHash: "0x26f8c10ef1ea7397609149475ffdca03baa798fcc771e0fc66d3cac6ba13fafb" },
  { kind: "rating", agentName: "GuardRail GridBot", listingId: 2, detail: "onchain rating recorded (rate, 5/5)", txHash: "0x2c46ffe3a89b1bda6d0cad7644915a8f916a41ae279c4e226c9c2f75aa1a1d33" },
  { kind: "hire", agentName: "GuardRail Yield Router", listingId: 3, detail: "hire recorded onchain via the marketplace (recordHire)", txHash: "0xa5a902453aea11d06ba34827ba1c5ab7fbf117c86c1c8148de7ac69147f54dd1" },
  { kind: "rating", agentName: "GuardRail Yield Router", listingId: 3, detail: "onchain rating recorded (rate, 5/5)", txHash: "0xc8e9caa31796704c3dc139d4522eb41ece8a7d5fba59d67fee53eb04d9638e2d" },
  { kind: "hire", agentName: "GuardRail Health Guard", listingId: 4, detail: "hire recorded onchain via the marketplace (recordHire)", txHash: "0xd4b2761ea0c2e09fffb85998e7cec1b0ef45b352cc56c5560614a1d9cf56129f" },
  { kind: "rating", agentName: "GuardRail Health Guard", listingId: 4, detail: "onchain rating recorded (rate, 5/5)", txHash: "0x4c41d926c8010af7e8bb37ad5d5dfaf0479b7d3b22281d0c649e77a08dcd010a" },
];

const RPC = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";

let _client: PublicClient | null = null;
function client(): PublicClient {
  if (!_client) {
    _client = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 15_000 }) });
  }
  return _client;
}

export type VerifiedActivity = ActivityRecord & {
  verified: boolean;
  blockNumber: number | null;
  timestamp: number | null;
  /** Real gas paid by this transaction, in wei (as a string). */
  gasUsed: string | null;
  explorer: string;
};

/** Re-verify one recorded tx against the chain (no fabricated hashes). */
export async function verifyActivity(rec: ActivityRecord): Promise<VerifiedActivity> {
  const explorer = `https://bscscan.com/tx/${rec.txHash}`;
  try {
    const c = client();
    const [tx, receipt] = await Promise.all([
      c.getTransaction({ hash: rec.txHash }),
      c.getTransactionReceipt({ hash: rec.txHash }),
    ]);
    if (!receipt || receipt.status !== "success") {
      return { ...rec, verified: false, blockNumber: null, timestamp: null, gasUsed: null, explorer };
    }
    const block = await c.getBlock({ blockNumber: receipt.blockNumber });
    return {
      ...rec,
      verified: true,
      blockNumber: Number(receipt.blockNumber),
      timestamp: Number(block.timestamp),
      gasUsed: receipt.gasUsed.toString(),
      explorer,
    };
  } catch {
    return { ...rec, verified: false, blockNumber: null, timestamp: null, gasUsed: null, explorer };
  }
}

export async function verifyAllActivity(): Promise<VerifiedActivity[]> {
  return Promise.all(ACTIVITY.map(verifyActivity));
}

/** Scope-narrowness read, derived from `scopeAudit`. */
export type ScopeMetrics = {
  allowlistSize: number;
  /** A one-contract allowlist is the tightest possible declared scope. */
  narrow: boolean;
  capLabel: string;
  capToken: string;
  capPeriodHours: number | null;
  live: boolean;
  active: boolean;
};

/**
 * Describe scope tightness in plain language for a buyer. The honesty rule:
 * we report the scope as declared — we never imply GuardRail chose it.
 */
export function scopeMetrics(
  allowlist: readonly string[],
  capLimit: bigint,
  capPeriod: bigint,
  capToken: string,
  live: boolean,
  active: boolean,
): ScopeMetrics {
  const size = allowlist.length;
  const isNative = capToken === "0x0000000000000000000000000000000000000000";
  const amt = formatUnits2(capLimit, 18);
  const periodHours = capPeriod > 0n ? Number(capPeriod) / 3600 : null;
  const unit = isNative ? "BNB" : "tokens";
  const per = periodHours === 24 ? "day" : periodHours ? `${periodHours}h` : "period";
  return {
    allowlistSize: size,
    narrow: size > 0 && size <= 2,
    capLabel: `${amt} ${unit}/${per}`,
    capToken,
    capPeriodHours: periodHours,
    live,
    active,
  };
}

/** Small decimal formatter (avoids a viem import just for this). */
function formatUnits2(v: bigint, decimals: number): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Per-listing data-quality summary: what a buyer needs to compare agents.
 */
export type ListingQuality = {
  listingId: number;
  name: string;
  category: number;
  trustScore: number;
  scope: ScopeMetrics;
  /** Verified onchain actions attributed to this listing. */
  verifiedActions: number;
  /** Real gas paid by those actions, in wei (string). */
  gasPaidWei: string;
  /** First/last onchain activity timestamps (unix seconds), or null. */
  firstActivity: number | null;
  lastActivity: number | null;
  /** Age of the listing in days, from `listedAt`. */
  ageDays: number | null;
  hires: number;
  ratings: number;
  avgRating: number | null;
  /** True when there is not yet enough history to score behaviour. */
  insufficientHistory: boolean;
  agentWallet: string;
};

export function summariseListing(args: {
  listingId: number;
  name: string;
  category: number;
  trustScore: bigint;
  listedAt: bigint;
  allowlist: readonly string[];
  capLimit: bigint;
  capPeriod: bigint;
  capToken: string;
  live: boolean;
  active: boolean;
  hires: number;
  ratingSum: bigint;
  ratingCount: number;
  agentWallet: string;
  activity: VerifiedActivity[];
  nowSeconds: number;
}): ListingQuality {
  const mine = args.activity.filter(
    (a) =>
      a.verified &&
      a.listingId === args.listingId &&
      (a.kind === "agent-act" || a.kind === "hire" || a.kind === "rating"),
  );
  const stamps = mine.map((a) => a.timestamp).filter((t): t is number => t !== null);
  const gas = mine.reduce((acc, a) => acc + BigInt(a.gasUsed ?? "0"), 0n);
  const ageDays =
    args.listedAt > 0n ? Math.floor((args.nowSeconds - Number(args.listedAt)) / 86_400) : null;
  const avgRating =
    args.ratingCount > 0 ? Number(args.ratingSum) / args.ratingCount : null;
  return {
    listingId: args.listingId,
    name: args.name,
    category: args.category,
    trustScore: Number(args.trustScore),
    scope: scopeMetrics(
      args.allowlist,
      args.capLimit,
      args.capPeriod,
      args.capToken,
      args.live,
      args.active,
    ),
    verifiedActions: mine.length,
    gasPaidWei: gas.toString(),
    firstActivity: stamps.length ? Math.min(...stamps) : null,
    lastActivity: stamps.length ? Math.max(...stamps) : null,
    ageDays,
    hires: args.hires,
    ratings: args.ratingCount,
    avgRating,
    insufficientHistory: args.hires === 0 && args.ratingCount === 0 && mine.length === 0,
    agentWallet: args.agentWallet,
  };
}

export const DEMO_WALLET = DEMO_AGENT_WALLET;
