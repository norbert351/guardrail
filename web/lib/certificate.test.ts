import { describe, it, expect } from "vitest";
import { encodeAbiParameters, keccak256, parseAbiParameters, type Address } from "viem";

/**
 * The scope certificate's commitment must be reproducible by a third party from
 * chain state alone. These tests pin the exact encoding so a future refactor
 * cannot silently change what the hash covers — which would invalidate every
 * certificate already published.
 */

const MARKETPLACE = "0xb7c80f5154952E48f6E1548282343000c45b80d6" as Address;
const AGENT = "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as Address;
const KEYID = "0x86e4173f6b0cf87a693418969f54604827eaaa4d50ff1c1c59a2d7efb1602b42" as const;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const PANCAKE = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as Address;
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address;

const PARAMS = parseAbiParameters(
  "address marketplace, uint256 listingId, address agentWallet, bytes32 sessionKeyId, address capToken, uint256 capLimit, uint256 capPeriod, address[] allowlist",
);

function commit(allowlist: Address[], opts: { listingId?: bigint; capLimit?: bigint; capPeriod?: bigint } = {}) {
  const sorted = [...allowlist].map((a) => a.toLowerCase() as Address).sort();
  return keccak256(
    encodeAbiParameters(PARAMS, [
      MARKETPLACE,
      opts.listingId ?? 1n,
      AGENT,
      KEYID,
      ZERO,
      opts.capLimit ?? 20000000000000000n,
      opts.capPeriod ?? 86400n,
      sorted,
    ]),
  );
}

// Live value captured from /api/scope-certificate?listingId=1 on 2026-09-11.
const LIVE_COMMITMENT = "0xcab3406e9fdb3684ac9113bf20ffb4c79d011fd04a61620126fe84c7a2d9db24";

describe("scope certificate commitment", () => {
  it("reproduces the live published commitment exactly", () => {
    expect(commit([PANCAKE, WBNB])).toBe(LIVE_COMMITMENT);
  });

  it("is invariant to allowlist ORDER (sorted before hashing)", () => {
    expect(commit([WBNB, PANCAKE])).toBe(commit([PANCAKE, WBNB]));
  });

  it("is invariant to allowlist ADDRESS CASE", () => {
    const upper = PANCAKE.toUpperCase().replace("0X", "0x") as Address;
    expect(commit([upper, WBNB])).toBe(commit([PANCAKE, WBNB]));
  });

  it("changes when the cap changes (a wider cap must not reuse a certificate)", () => {
    expect(commit([PANCAKE, WBNB], { capLimit: 20000000000000001n })).not.toBe(LIVE_COMMITMENT);
  });

  it("changes when the period changes", () => {
    expect(commit([PANCAKE, WBNB], { capPeriod: 172800n })).not.toBe(LIVE_COMMITMENT);
  });

  it("changes when an extra contract is allowlisted", () => {
    expect(commit([PANCAKE, WBNB, AGENT])).not.toBe(LIVE_COMMITMENT);
  });

  it("changes with the listing id", () => {
    expect(commit([PANCAKE, WBNB], { listingId: 2n })).not.toBe(LIVE_COMMITMENT);
  });

  it("produces a 32-byte hash", () => {
    expect(commit([PANCAKE, WBNB])).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
