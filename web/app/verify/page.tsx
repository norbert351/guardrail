import Link from "next/link";
import { Logomark } from "@/components/Logomark";

export const dynamic = "force-dynamic";

/**
 * /verify — the portable scope certificate.
 *
 * The uniqueness play, made visible: every other entry in this category
 * *asserts* "out-of-scope calls are blocked". This page produces a
 * self-contained certificate a third party can re-derive from chain state with
 * cast/viem alone — no GuardRail server in the loop.
 *
 * Server-rendered so a judge can open it with JS off and still see the payload.
 */
type Cert = {
  version: number;
  chainId: number;
  issuedAt: string;
  pinnedBlock: number;
  blockHash: string;
  contracts: { marketplace: string; keyStore: string; registry8004: string };
  subject: { listingId: number; name: string; agentWallet: string; sessionKeyId: string; category: number };
  declaredAuthority: {
    allowlist: string[];
    allowlistSize: number;
    capToken: string;
    capLimit: string;
    capPeriodSeconds: number;
    marketplaceReportsLive: boolean;
    keyStoreReportsLive: boolean | null;
    independentSourcesAgree: boolean | null;
  };
  trustScore: number;
  scopeCommitment: string;
  verdict: string;
  howToVerify: { summary: string; steps: string[]; note: string };
};

async function loadCert(id: number): Promise<Cert | null> {
  const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.GUARDRAIL_SITE_URL ?? "http://127.0.0.1:3050";
  try {
    const r = await fetch(`${base}/api/scope-certificate?listingId=${id}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { ok: boolean; certificate?: Cert };
    return j.ok && j.certificate ? j.certificate : null;
  } catch {
    return null;
  }
}

const CATEGORY_NAMES = ["Rebalancing", "Grid Trading", "Yield Optimisation", "Health Factor Monitoring"];

function short(s: string, head = 10, tail = 8) {
  return s.length > head + tail + 2 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const sp = await searchParams;
  const id = Number(sp.id ?? "1") || 1;
  const cert = await loadCert(id);

  const verdictTone = !cert
    ? "dead"
    : cert.verdict.startsWith("CONTAINED")
      ? "live"
      : cert.verdict.startsWith("MISMATCH")
        ? "dead"
        : "warn";

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--gr-border)] bg-[var(--gr-bg)]">
        <div className="mx-auto max-w-4xl px-6 pt-8 pb-10">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Logomark />
              <span className="font-display text-lg font-bold tracking-tight text-[var(--gr-ink)]">GuardRail</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/agents" className="gr-link text-sm font-semibold text-[var(--gr-ink)]">Agents</Link>
              <Link href="/proof" className="gr-link text-sm font-semibold text-[var(--gr-ink)]">/proof</Link>
            </div>
          </nav>
          <div className="mt-10">
            <p className="eyebrow">Portable scope certificate</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[var(--gr-ink)] sm:text-4xl">
              Proof of containment, not a promise
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--gr-ink-2)]">
              Every marketplace in this category <em>claims</em> that out-of-scope calls are blocked. This page emits a
              self-contained certificate you can re-derive from chain state yourself — with <code className="font-mono text-xs">cast</code> or{" "}
              <code className="font-mono text-xs">viem</code>, no GuardRail server involved. The commitment below is a
              keccak256 over exactly the fields that define the agent&apos;s authority.
            </p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex flex-wrap gap-2">
          {[1, 2, 3, 4].map((i) => (
            <Link
              key={i}
              href={`/verify?id=${i}`}
              className={`rounded-lg border px-3 py-1.5 font-mono text-xs ${
                i === id
                  ? "border-[var(--gr-magenta)] bg-[var(--gr-magenta)] text-white"
                  : "border-[var(--gr-border)] bg-[var(--gr-surface)] text-[var(--gr-ink)]"
              }`}
            >
              listing #{i}
            </Link>
          ))}
        </div>

        {!cert ? (
          <div className="rounded-2xl border border-[var(--gr-dead)]/30 bg-[var(--gr-dead-soft)] p-6">
            <h2 className="font-display text-lg font-semibold text-[var(--gr-ink)]">No certificate</h2>
            <p className="mt-2 text-sm text-[var(--gr-ink-2)]">
              Could not build a certificate for listing #{id} — the listing may not exist, or the chain read failed.
            </p>
          </div>
        ) : (
          <>
            <div
              className={`rounded-2xl border p-6 ${
                verdictTone === "live"
                  ? "border-[var(--gr-live)]/35 bg-[var(--gr-live-soft)]"
                  : verdictTone === "warn"
                    ? "border-amber-400/40 bg-amber-50"
                    : "border-[var(--gr-dead)]/35 bg-[var(--gr-dead-soft)]"
              }`}
            >
              <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-[var(--gr-ink-3)]">Verdict</p>
              <p className="mt-1 font-display text-xl font-bold text-[var(--gr-ink)]">{cert.verdict}</p>
              <div className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {[
                  ["Subject", `${cert.subject.name} (listing #${cert.subject.listingId})`],
                  ["Category", CATEGORY_NAMES[cert.subject.category] ?? "—"],
                  ["Agent wallet", short(cert.subject.agentWallet)],
                  ["Session key", short(cert.subject.sessionKeyId)],
                  ["Pinned block", String(cert.pinnedBlock)],
                  ["Issued", cert.issuedAt],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[var(--gr-border)]/60 py-1">
                    <span className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">{k}</span>
                    <span className="font-mono text-[0.6875rem] text-[var(--gr-ink)]">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-5">
                <h2 className="font-display text-base font-semibold text-[var(--gr-ink)]">Declared authority</h2>
                <dl className="mt-3 space-y-1">
                  {[
                    ["Allowlist size", `${cert.declaredAuthority.allowlistSize} contract(s)`],
                    ["Cap", `${Number(cert.declaredAuthority.capLimit) / 1e18} BNB / ${cert.declaredAuthority.capPeriodSeconds / 3600}h`],
                    ["Marketplace says live", String(cert.declaredAuthority.marketplaceReportsLive)],
                    ["KeyStore says live", String(cert.declaredAuthority.keyStoreReportsLive)],
                    ["Independent sources agree", cert.declaredAuthority.independentSourcesAgree === null ? "unknown" : String(cert.declaredAuthority.independentSourcesAgree)],
                    ["trustScore", `${cert.trustScore}/100`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3">
                      <dt className="font-mono text-[0.625rem] text-[var(--gr-ink-3)]">{k}</dt>
                      <dd className="font-mono text-[0.625rem] text-[var(--gr-ink)]">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 font-mono text-[0.625rem] break-all text-[var(--gr-ink-3)]">
                  allowlist: {cert.declaredAuthority.allowlist.map((a) => short(a, 8, 6)).join(", ")}
                </p>
              </div>

              <div className="rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-5">
                <h2 className="font-display text-base font-semibold text-[var(--gr-ink)]">Commitment</h2>
                <p className="mt-2 font-mono text-[0.625rem] break-all text-[var(--gr-magenta)]">{cert.scopeCommitment}</p>
                <p className="mt-3 text-xs leading-relaxed text-[var(--gr-ink-2)]">{cert.howToVerify.summary}</p>
                <ol className="mt-3 space-y-1.5">
                  {cert.howToVerify.steps.map((s, i) => (
                    <li key={i} className="font-mono text-[0.625rem] leading-relaxed text-[var(--gr-ink-3)]">{s}</li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-5">
              <h2 className="font-display text-base font-semibold text-[var(--gr-ink)]">Reproduce it yourself</h2>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--gr-bg)] p-4 font-mono text-[0.625rem] leading-relaxed text-[var(--gr-ink)]">
{`# 1. read the scope at the pinned block (archive-capable RPC for old heights)
cast call ${cert.contracts.marketplace} \\
  "scopeAudit(uint256)(address,bytes32,address,uint256,uint256,address[],bool,bool)" \\
  ${cert.subject.listingId} --block ${cert.pinnedBlock} --rpc-url <RPC>

# 2. ask the KeyStore independently
cast call ${cert.contracts.keyStore} "isValidKey(address,bytes32)(bool)" \\
  ${cert.subject.agentWallet} ${cert.subject.sessionKeyId} --rpc-url <RPC>

# 3. recompute the commitment (fields sorted by contract address)
cast keccak $(cast abi-encode \\
  "f(address,uint256,address,bytes32,address,uint256,uint256,address[])" \\
  ${cert.contracts.marketplace} ${cert.subject.listingId} \\
  ${cert.subject.agentWallet} ${cert.subject.sessionKeyId} \\
  ${cert.declaredAuthority.capToken} ${cert.declaredAuthority.capLimit} \\
  ${cert.declaredAuthority.capPeriodSeconds} \\
  "[${cert.declaredAuthority.allowlist.join(",")}]")

# → must equal ${cert.scopeCommitment}

# 4. machine-readable form
curl "${process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://guardrail-delta.vercel.app"}/api/scope-certificate?listingId=${cert.subject.listingId}"`}
              </pre>
              <p className="mt-3 font-mono text-[0.625rem] text-[var(--gr-ink-3)]">{cert.howToVerify.note}</p>
            </div>
          </>
        )}

        <p className="mt-8 font-mono text-xs text-[var(--gr-ink-3)]">
          The certificate is derived, not asserted. If the session is revoked, the listing paused, or the declared scope
          changes, the verdict and the commitment both change — and a third party recomputing from the same block will
          see the same result.
        </p>
      </section>
    </main>
  );
}
