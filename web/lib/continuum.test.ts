import { describe, it, expect, vi, afterEach } from "vitest";
import {
  recallPriorDenial,
  recordVerdict,
  guardWithMemory,
} from "./continuum";

// The consumer is best-effort network code: unit-test the decision logic by
// stubbing global fetch. Denial-recall must RE-APPLY a remembered denial, and
// must never soften the onchain verdict on network failure.

function mockFetch(json: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => json,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = undefined as never;
});

const WALLET = "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97";

describe("recallPriorDenial", () => {
  it("returns denied=true when a matching denial node is recalled", async () => {
    globalThis.fetch = mockFetch({
      recall: [
        {
          node: {
            kind: "resolution",
            label: "gated_deny on guardrail:drain:0xa847f3bbf69e8a888b59bc8729ce787e0db5be97",
            text: "guardrail:drain:0xa847f3bbf69e8a888b59bc8729ce787e0db5be97 → gated_deny: guardrail_denied_drain",
          },
          score: 0.65,
        },
      ],
    });
    const r = await recallPriorDenial("drain", WALLET);
    expect(r?.denied).toBe(true);
    expect(r?.recalledReason).toContain("gated_deny");
  });

  it("returns denied=false when nothing matches", async () => {
    globalThis.fetch = mockFetch({ recall: [] });
    const r = await recallPriorDenial("drain", WALLET);
    expect(r?.denied).toBe(false);
  });

  it("returns null when Continuum is unreachable (never hard-fails)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const r = await recallPriorDenial("drain", WALLET);
    expect(r).toBeNull();
  });
});

describe("recordVerdict", () => {
  it("posts a deny record and returns true on ok", async () => {
    globalThis.fetch = mockFetch({}, true);
    const ok = await recordVerdict({
      scenario: "drain",
      target: "0xDead",
      agentWallet: WALLET,
      allowed: false,
      reason: "UnauthorizedCall",
    });
    expect(ok).toBe(true);
  });

  it("returns false when the record fails", async () => {
    globalThis.fetch = mockFetch({}, false);
    const ok = await recordVerdict({
      scenario: "drain",
      target: "0xDead",
      agentWallet: WALLET,
      allowed: false,
      reason: "UnauthorizedCall",
    });
    expect(ok).toBe(false);
  });
});

describe("guardWithMemory", () => {
  it("re-applies a remembered denial instead of re-deriving (allowed -> denied)", async () => {
    globalThis.fetch = mockFetch({
      recall: [
        {
          node: {
            kind: "resolution",
            label: "gated_deny on guardrail:drain:0xa847f3bbf69e8a888b59bc8729ce787e0db5be97",
            text: "guardrail:drain:0xa847f3bbf69e8a888b59bc8729ce787e0db5be97 → gated_deny: guardrail_denied_drain",
          },
          score: 0.8,
        },
      ],
    });
    // Onchain says within-scope (allowed=true), but Continuum remembers a denial.
    const { fromMemory, verdict } = await guardWithMemory({
      scenario: "drain",
      target: "0xRouter",
      agentWallet: WALLET,
      allowed: true,
      reason: "Within scope",
    });
    expect(fromMemory).toBe(true);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("guardrail:drain");
  });

  it("keeps the onchain verdict and records it when no denial is remembered", async () => {
    const fetchMock = mockFetch({ recall: [] });
    globalThis.fetch = fetchMock;
    const { fromMemory, verdict } = await guardWithMemory({
      scenario: "within",
      target: "0xRouter",
      agentWallet: WALLET,
      allowed: true,
      reason: "Within scope",
    });
    expect(fromMemory).toBe(false);
    expect(verdict.allowed).toBe(true);
    // Both /recall and /record were called.
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(fetchMock.mock.calls[1][1].body).toContain("gated_allow");
  });

  it("falls through to the onchain verdict when Continuum is down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("down"));
    const { fromMemory, verdict } = await guardWithMemory({
      scenario: "drain",
      target: "0xDead",
      agentWallet: WALLET,
      allowed: false,
      reason: "UnauthorizedCall",
    });
    expect(fromMemory).toBe(false);
    expect(verdict.allowed).toBe(false); // onchain still governs
  });
});