import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  merchantCandidates,
  callMerchant,
  merchantDownMessage,
  KNOWN_MERCHANT_HOSTS,
  __resetPreferredMerchant,
} from "../lib/merchant";

const OLD = "https://guardrail-nxzi.onrender.com";
const NEW = "https://guardrail-ohky.onrender.com";

beforeEach(() => {
  __resetPreferredMerchant();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetPreferredMerchant();
  delete process.env.GUARDRAIL_MERCHANT_URL;
});

describe("merchantCandidates", () => {
  it("includes the current live host", () => {
    delete process.env.GUARDRAIL_MERCHANT_URL;
    expect(merchantCandidates()).toContain(NEW);
  });

  it("never targets a known-retired host", () => {
    process.env.GUARDRAIL_MERCHANT_URL = OLD;
    expect(merchantCandidates()).not.toContain(OLD);
  });

  it("prefers an explicitly configured host that is not retired", () => {
    process.env.GUARDRAIL_MERCHANT_URL = "https://my-merchant.example.com";
    expect(merchantCandidates()[0]).toBe("https://my-merchant.example.com");
  });

  it("falls back to the known host when the configured one is retired", () => {
    process.env.GUARDRAIL_MERCHANT_URL = OLD;
    expect(merchantCandidates()[0]).toBe(NEW);
  });

  it("returns no duplicates", () => {
    const c = merchantCandidates();
    expect(new Set(c).size).toBe(c.length);
  });

  it("does not expose the retired host anywhere in the list", () => {
    expect(KNOWN_MERCHANT_HOSTS).toContain(OLD);
    expect(merchantCandidates()).not.toContain(OLD);
  });
});

describe("callMerchant", () => {
  beforeEach(() => {
    delete process.env.GUARDRAIL_MERCHANT_URL;
  });

  it("returns the parsed JSON body from a live merchant", async () => {
    const body = { accepts: [{ network: "eip155:56", amount: "100000000000000000" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 402 })));
    const res = await callMerchant("health", {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.status).toBe(402);
      expect(res.body).toEqual(body);
    }
  });

  it("skips a host serving HTML (suspended page) and uses the next JSON host", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls++;
        if (String(url).includes("suspended")) {
          return new Response("<!DOCTYPE html><title>Service Suspended</title>", { status: 503 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    // A stale env var pointing at a retired/HTML-serving host must not win.
    process.env.GUARDRAIL_MERCHANT_URL = "https://suspended.example.com";
    const res = await callMerchant("health", {});
    expect(res.ok).toBe(true);
    expect(calls).toBeGreaterThan(1);
  });

  it("reports failure when every candidate fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>nope</html>", { status: 503 })));
    const res = await callMerchant("health", {});
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(503);
      expect(res.reason).toMatch(/unavailable/i);
    }
  });

  it("survives a network throw and tries the next candidate", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        if (seen.length === 1) throw new Error("ECONNREFUSED");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const res = await callMerchant("health", {});
    expect(res.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
  });
});

describe("merchantDownMessage", () => {
  it("distinguishes a network error from an HTTP failure", () => {
    expect(merchantDownMessage(0)).toMatch(/network error/i);
    expect(merchantDownMessage(503)).toMatch(/HTTP 503/);
  });

  it("never claims the rest of the product is down", () => {
    for (const s of [0, 502, 503]) {
      expect(merchantDownMessage(s)).toMatch(/remain fully live/i);
    }
  });
});
