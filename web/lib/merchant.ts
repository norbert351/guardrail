/**
 * Resolve the x402 merchant base URL, with a fallback chain so a stale env var
 * cannot silently kill every Buy button.
 *
 * History that made this necessary: the merchant Render service was suspended
 * and later re-created under a NEW hostname (`guardrail-ohky.onrender.com`).
 * `GUARDRAIL_MERCHANT_URL` on Vercel still pointed at the old, dead host, so
 * `/api/x402/*` returned 503 while a perfectly healthy merchant was serving.
 * A hostname rotation needs a dashboard edit — which is exactly the kind of
 * thing that gets missed under deadline. This module makes the code tolerant:
 * try the configured URL first, then every known-good host, and remember which
 * one answered so later calls go straight there.
 */

/** Hosts that have served the GuardRail x402 merchant, newest first. */
export const KNOWN_MERCHANT_HOSTS = [
  "https://guardrail-ohky.onrender.com",
  // Superseded / never-live hosts kept only so an old env var is recognised as
  // stale rather than treated as a valid target.
  "https://guardrail-nxzi.onrender.com",
] as const;

const LOCAL = "http://127.0.0.1:8787";

/** Hosts we never want to waste a request on. */
const RETIRED = new Set(["https://guardrail-nxzi.onrender.com"]);

/** Cache the host that last worked, so we don't probe on every request. */
let preferred: string | null = null;

/** Test/reset hook — clears the cached winning host. */
export function __resetPreferredMerchant(): void {
  preferred = null;
}

function configured(): string | null {
  const v = process.env.GUARDRAIL_MERCHANT_URL?.trim();
  if (!v) return null;
  return v.replace(/\/$/, "");
}

/**
 * Ordered candidate list: the live preferred host, the configured env value
 * (unless it is a known-retired host), then the remaining known hosts.
 */
export function merchantCandidates(): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    if (!u || out.includes(u)) return;
    out.push(u);
  };
  push(preferred);
  const cfg = configured();
  if (cfg && !RETIRED.has(cfg)) push(cfg);
  for (const h of KNOWN_MERCHANT_HOSTS) if (!RETIRED.has(h)) push(h);
  // Local dev only makes sense when nothing remote is configured.
  if (!cfg && process.env.NODE_ENV !== "production") push(LOCAL);
  return out;
}

export type MerchantResult =
  | { ok: true; base: string; status: number; body: unknown }
  | { ok: false; status: number; reason: string };

/**
 * Call `<host>/v1/agents/<kind>` across the candidate hosts, returning the
 * first response that parses as JSON (a live merchant always answers with JSON,
 * even for a 402). A host serving an HTML error page (Render "Service
 * Suspended", a proxy 5xx) is treated as a failed candidate and we move on.
 */
export async function callMerchant(
  kind: string,
  headers: Record<string, string>,
  timeoutMs = 12_000,
): Promise<MerchantResult> {
  const candidates = merchantCandidates();
  let lastStatus = 0;

  for (const base of candidates) {
    try {
      const r = await fetch(`${base}/v1/agents/${kind}`, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await r.text();
      try {
        const body = JSON.parse(raw) as unknown;
        preferred = base; // remember the winner
        return { ok: true, base, status: r.status, body };
      } catch {
        // Non-JSON body => not a healthy merchant (suspended page, proxy error).
        lastStatus = r.status;
      }
    } catch {
      // network error / timeout => try the next candidate
    }
  }

  return {
    ok: false,
    status: lastStatus || 503,
    reason: merchantDownMessage(lastStatus),
  };
}

/**
 * A short, honest, human-readable reason the paid-report rail is unavailable.
 * Distinguishes "host suspended/restarting" from "network failure", because the
 * first needs a dashboard action and the second is transient.
 */
export function merchantDownMessage(status: number): string {
  if (status === 0) {
    return "Could not reach the x402 merchant service (network error). Paid report purchase is temporarily off; listings, scope audits and the safety proof remain fully live and onchain.";
  }
  return `The x402 merchant service is currently unavailable (HTTP ${status} — host suspended or restarting). Paid report purchase is temporarily off; listings, scope audits and the safety proof remain fully live and onchain.`;
}
