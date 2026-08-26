"use client";

import { useState } from "react";

type Proof = {
  scenario: string;
  label: string;
  hint: string;
  target: string;
  valueBnb: string;
  allowed: boolean;
  reason: string;
  sessionLive: boolean;
  listingActive: boolean;
  capLimitBnb: number | null;
  capToken: string;
  allowlist: string[];
  agentWallet: string;
  sessionKeyId: string;
};

const SCENARIOS = [
  { id: "drain", label: "Drain the whole wallet", detail: "10 BNB out" },
  { id: "call", label: "Call a contract outside the allowlist", detail: "random DEX" },
  { id: "cap", label: "Exceed the daily spend cap", detail: "5 BNB at once" },
  { id: "within", label: "Act inside the scope", detail: "small allowed call" },
];

export function SafetyProof() {
  const [proof, setProof] = useState<Proof | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string>("drain");

  async function run(id: string) {
    setPicked(id);
    setBusy(true);
    setProof(null);
    try {
      const res = await fetch(`/api/safety-proof?listingId=1&kind=${id}`);
      const json = await res.json();
      setProof(json);
    } catch {
      setProof(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-6 pb-12">
      <div className="overflow-hidden rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--gr-border)] p-6">
          <div>
            <p className="eyebrow">Scoped sessions, proven</p>
            <h3 className="mt-2 font-display text-xl font-bold text-[var(--gr-ink)]">
              Watch an agent get blocked — onchain scope, live
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-[var(--gr-ink-2)]">
              Pick an attack. GuardRail reads this agent's real KeyStore-bound allowlist and spend cap
              (via <code className="font-mono text-[0.6875rem]">scopeAudit()</code>) and tells you exactly why the intent
              reverts — no gas, no broadcast.
            </p>
          </div>
        </div>

        <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => run(s.id)}
              disabled={busy}
              className={`rounded-xl border p-4 text-left transition disabled:opacity-50 ${
                picked === s.id
                  ? "border-[var(--gr-magenta)] bg-[var(--gr-magenta-soft)]"
                  : "border-[var(--gr-border)] bg-[var(--gr-bg)] hover:border-[var(--gr-magenta)]"
              }`}
            >
              <div className="flex items-center gap-2 font-mono text-[0.625rem] font-semibold tracking-wider text-[var(--gr-magenta)] uppercase">
                ⚔ {s.detail}
              </div>
              <p className="mt-1.5 text-sm font-medium text-[var(--gr-ink)]">{s.label}</p>
            </button>
          ))}
        </div>

        {proof && (
          <div className="mx-6 mb-6 rounded-xl border border-[var(--gr-border)] bg-[var(--gr-bg)] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs text-[var(--gr-ink-3)]">verdict for “{proof.label}”</p>
                <p className={`mt-1 font-display text-lg font-bold ${proof.allowed ? "text-[var(--gr-live)]" : "text-[var(--gr-dead)]"}`}>
                  {proof.allowed ? "✓ Allowed — within scope" : "✗ Blocked"}
                </p>
                <p className="mt-1 text-sm text-[var(--gr-ink-2)]">{proof.reason}</p>
              </div>
              {!proof.allowed && (
                <span className="shrink-0 rounded-full bg-[var(--gr-dead-soft)] px-3 py-1 font-mono text-[0.6875rem] font-medium text-[var(--gr-dead)]">
                  revert (no gas spent)
                </span>
              )}
            </div>

            <div className="mt-4 grid gap-2 border-t border-[var(--gr-border)] pt-4 font-mono text-[0.6875rem] text-[var(--gr-ink-3)] sm:grid-cols-2">
              <div>target — {proof.target.slice(0, 12)}…{proof.target.slice(-6)}</div>
              <div>value — {proof.valueBnb} BNB</div>
              <div>session keys live onchain — {proof.sessionLive ? "yes" : "no"}</div>
              <div>spend cap — {proof.capLimitBnb !== null ? `${proof.capLimitBnb} BNB/day` : "token-based"}</div>
              <div className="sm:col-span-2">
                allowlist ({proof.allowlist.length}) — {proof.allowlist.map((a) => a.slice(0, 8)).join(", ")}…
              </div>
            </div>
          </div>
        )}

        {!proof && !busy && (
          <p className="px-6 pb-6 font-mono text-xs text-[var(--gr-ink-3)]">
            The 4 live agents all act through these same onchain constraints.
          </p>
        )}
      </div>
    </section>
  );
}