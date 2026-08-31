// Continuum consumer for GuardRail — "a denial it has seen before is re-applied
// instead of re-derived."
//
// GuardRail enforces a boundary onchain (allowlist + cap + expiry, all read from
// the live Altana scope). This module sits one layer above: before GuardRail
// re-evaluates a request, it recalls the agent's past decisions from Continuum
// (the provable, load-bearing memory layer). If a prior DENY for the exact same
// scenario exists, GuardRail re-applies it from memory and does not re-derive.
// Every verdict is then recorded back to Continuum so the denial is remembered.
//
// It talks to Continuum over its documented HTTP API (POST /recall, POST
// /record, project-scoped) — no extra SDK dependency.

export const CONTINUUM_API = process.env.CONTINUUM_API_URL ?? "https://continuum-pf3n.onrender.com";
export const CONTINUUM_PROJECT = process.env.CONTINUUM_PROJECT_ID ?? "guardrail";

interface GuardrailJudge {
  scenario: string;
  target: string;
  agentWallet: string;
  allowed: boolean;
  reason: string;
}

interface ContinuumHit {
  node?: { kind?: string; label?: string; text?: string };
  score?: number;
}

/**
 * Recall whether GuardRail previously denied this exact scenario for this
 * wallet. Best-effort: if Continuum is unreachable it returns null so the
 * onchain gate is the source of truth (memory never makes GuardRail less safe).
 */
export async function recallPriorDenial(
  scenario: string,
  agentWallet: string,
): Promise<{ denied: boolean; recalledReason?: string; decisionId?: string } | null> {
  try {
    const r = await fetch(`${CONTINUUM_API}/recall`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-project-id": CONTINUUM_PROJECT },
      body: JSON.stringify({ text: `guardrail denial for scenario ${scenario} on ${agentWallet}`, k: 5 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const body = await r.json();
    const recall: ContinuumHit[] = body.recall ?? [];
    // Look for a recorded DENY node for this exact scenario+wallet. Real
    // records store runbook "gated_deny" and an incidentId of the form
    // "guardrail:<scenario>:<lowercase wallet>".
    const scenarioKey = `guardrail:${scenario}:`;
    const walletKey = agentWallet.toLowerCase();
    for (const hit of recall) {
      const text = `${hit.node?.text ?? ""} ${hit.node?.label ?? ""}`.toLowerCase();
      const isDenial = text.includes("gated_deny") || text.includes("deny:");
      if (
        isDenial &&
        text.includes(scenarioKey) &&
        text.includes(walletKey) &&
        (hit.score ?? 0) >= 0.4
      ) {
        return { denied: true, recalledReason: hit.node?.label ?? "recalled prior GuardRail denial" };
      }
    }
    return { denied: false };
  } catch {
    return null;
  }
}

/**
 * Record a GuardRail verdict back to Continuum so a future request recalls it.
 * Denials are the load-bearing outcome (re-applied, not re-derived).
 */
export async function recordVerdict(judge: GuardrailJudge): Promise<boolean> {
  try {
    const r = await fetch(`${CONTINUUM_API}/record`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-project-id": CONTINUUM_PROJECT },
      body: JSON.stringify({
        incidentId: `guardrail:${judge.scenario}:${judge.agentWallet.toLowerCase()}`,
        runbook: `gated_${judge.allowed ? "allow" : "deny"}`,
        action: `guardrail_${judge.allowed ? "allowed" : "denied"}_${judge.scenario}`,
        fixed: judge.allowed, // a deny that holds is the "fix that worked"
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * The GuardRail gate: recall-then-rule. If Continuum remembers a prior denial
 * for this scenario, return it as the verdict (re-applied from memory).
 * Otherwise judge from onchain scope and record the outcome.
 */
export async function guardWithMemory(
  judge: GuardrailJudge,
): Promise<{ fromMemory: boolean; verdict: GuardrailJudge }> {
  const prior = await recallPriorDenial(judge.scenario, judge.agentWallet);
  if (prior?.denied) {
    return {
      fromMemory: true,
      verdict: {
        ...judge,
        allowed: false,
        reason: prior.recalledReason ?? "Re-applied prior GuardRail denial from Continuum memory",
      },
    };
  }
  // No prior denial: return the onchain verdict and remember it.
  await recordVerdict(judge);
  return { fromMemory: false, verdict: judge };
}