import { describe, it, expect } from "vitest";
import { scopeMetrics, summariseListing, ACTIVITY, type VerifiedActivity } from "../lib/quality";

const WALLET = "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const PANCAKE = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as const;
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as const;

function act(over: Partial<VerifiedActivity> = {}): VerifiedActivity {
  return {
    kind: "agent-act",
    agentName: "GuardRail LP Guardian",
    listingId: 1,
    detail: "test",
    txHash: "0x2d022320c99f7424dcea33b1c72ad070262fd511f98bcfb935530eff760b43bb",
    verified: true,
    blockNumber: 121133460,
    timestamp: 1_788_000_000,
    gasUsed: "100000",
    explorer: "https://bscscan.com/tx/0x2d02",
    ...over,
  };
}

describe("scopeMetrics", () => {
  it("labels a two-address allowlist as narrow", () => {
    const m = scopeMetrics([PANCAKE, WBNB], 20_000_000_000_000_000n, 86_400n, ZERO, true, true);
    expect(m.allowlistSize).toBe(2);
    expect(m.narrow).toBe(true);
    expect(m.capLabel).toBe("0.02 BNB/day");
    expect(m.capPeriodHours).toBe(24);
    expect(m.live).toBe(true);
  });

  it("does NOT call a wide allowlist narrow", () => {
    const wide = [PANCAKE, WBNB, PANCAKE, WBNB, PANCAKE];
    expect(scopeMetrics(wide, 1n, 86_400n, ZERO, true, true).narrow).toBe(false);
  });

  it("treats an empty allowlist as not-narrow (honest, not a pass)", () => {
    expect(scopeMetrics([], 1n, 86_400n, ZERO, false, false).narrow).toBe(false);
  });

  it("formats a non-native cap token as tokens", () => {
    const m = scopeMetrics([PANCAKE], 1_000_000n, 3_600n, "0xcE24439F2D9C6a2289F741120FE202248B666666", true, true);
    expect(m.capLabel).toBe("0.000000000001 tokens/1h");
  });

  it("reports an unset period without inventing a day", () => {
    expect(scopeMetrics([PANCAKE], 1n, 0n, ZERO, true, true).capPeriodHours).toBeNull();
  });
});

describe("summariseListing — the honesty rules", () => {
  const base = {
    listingId: 1,
    name: "GuardRail LP Guardian",
    category: 0,
    trustScore: 40n,
    listedAt: 1_788_000_000n,
    allowlist: [PANCAKE, WBNB] as readonly `0x${string}`[],
    capLimit: 20_000_000_000_000_000n,
    capPeriod: 86_400n,
    capToken: ZERO,
    live: true,
    active: true,
    hires: 0,
    ratingSum: 0n,
    ratingCount: 0,
    agentWallet: WALLET,
    nowSeconds: 1_788_086_400,
  };

  it("flags insufficientHistory when there are no hires, ratings or actions", () => {
    const r = summariseListing({ ...base, activity: [] });
    expect(r.insufficientHistory).toBe(true);
    expect(r.avgRating).toBeNull();
    expect(r.verifiedActions).toBe(0);
    expect(r.gasPaidWei).toBe("0");
  });

  it("counts only VERIFIED actions for this listing", () => {
    const r = summariseListing({
      ...base,
      activity: [
        act(),
        act({ verified: false }),                       // unverified → excluded
        act({ listingId: 2 }),                          // other listing → excluded
        act({ kind: "listed" }),                        // not an agent-act → excluded
      ],
    });
    expect(r.verifiedActions).toBe(1);
    expect(r.gasPaidWei).toBe("100000");
  });

  it("does not report insufficientHistory once a real hire exists", () => {
    const r = summariseListing({ ...base, hires: 2, activity: [] });
    expect(r.insufficientHistory).toBe(false);
  });

  it("computes avgRating only from real ratings", () => {
    const r = summariseListing({ ...base, ratingSum: 9n, ratingCount: 2, hires: 2, activity: [] });
    expect(r.avgRating).toBe(4.5);
  });

  it("derives first/last activity from verified timestamps only", () => {
    const r = summariseListing({
      ...base,
      activity: [act({ timestamp: 100 }), act({ timestamp: 900 }), act({ timestamp: 5000, verified: false })],
    });
    expect(r.firstActivity).toBe(100);
    expect(r.lastActivity).toBe(900);
  });

  it("computes listing age in days from listedAt", () => {
    expect(summariseListing({ ...base, activity: [] }).ageDays).toBe(1);
  });

  it("returns null ageDays when listedAt is unset", () => {
    expect(summariseListing({ ...base, listedAt: 0n, activity: [] }).ageDays).toBeNull();
  });
});

describe("ACTIVITY ledger integrity", () => {
  it("contains only well-formed mainnet tx hashes", () => {
    expect(ACTIVITY.length).toBeGreaterThan(0);
    for (const a of ACTIVITY) {
      expect(a.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(a.detail.length).toBeGreaterThan(10);
    }
  });

  it("has no duplicate tx hashes", () => {
    const set = new Set(ACTIVITY.map((a) => a.txHash));
    expect(set.size).toBe(ACTIVITY.length);
  });

  it("attributes each agent-act to a real listing id", () => {
    for (const a of ACTIVITY.filter((x) => x.kind === "agent-act")) {
      expect(typeof a.listingId).toBe("number");
      expect(a.listingId!).toBeGreaterThan(0);
    }
  });
});
