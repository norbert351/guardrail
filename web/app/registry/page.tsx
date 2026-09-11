import Link from "next/link";
import { Logomark } from "@/components/Logomark";
import { enumerateRegistry, readAgent, IDENTITY_REGISTRY } from "@/lib/registry";

export const dynamic = "force-dynamic";

/**
 * /registry — open ERC-8004 discovery.
 *
 * Every agent anyone has registered on the BSC mainnet IdentityRegistry, read
 * straight from the contract. No submission, no database, no approval. Listed is
 * not vetted, and this page says so.
 */
function short(s: string, head = 10, tail = 8) {
  return s.length > head + tail + 2 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

/** GuardRail's own identity id → its marketplace listing id (1-based). */
const OWN_LISTING_BY_ID: Record<number, number> = { 345084: 1, 345085: 2, 345086: 3, 345087: 4 };

export default async function RegistryPage({ searchParams }: { searchParams: Promise<{ agentId?: string }> }) {
  const sp = await searchParams;
  const oneId = sp.agentId ? Number(sp.agentId) : null;

  let agents: Awaited<ReturnType<typeof enumerateRegistry>>["agents"] = [];
  let live = 0;
  let scanned: [number, number] = [0, 0];
  let error: string | null = null;

  try {
    if (oneId && Number.isInteger(oneId) && oneId > 0) {
      const a = await readAgent(oneId);
      if (a) {
        agents = [a];
        live = 1;
        scanned = [oneId, oneId];
      }
    } else {
      const r = await enumerateRegistry({ from: 345000, to: 345100 });
      agents = r.agents;
      live = r.live;
      scanned = r.scanned;
    }
  } catch (e) {
    error = String((e as Error)?.message ?? e).slice(0, 200);
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--gr-border)] bg-[var(--gr-bg)]">
        <div className="mx-auto max-w-5xl px-6 pt-8 pb-10">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Logomark />
              <span className="font-display text-lg font-bold tracking-tight text-[var(--gr-ink)]">GuardRail</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/agents" className="gr-link text-sm font-semibold text-[var(--gr-ink)]">Agents</Link>
              <Link href="/verify" className="gr-link text-sm font-semibold text-[var(--gr-ink)]">/verify</Link>
            </div>
          </nav>
          <div className="mt-10">
            <p className="eyebrow">ERC-8004 identity registry · BSC mainnet</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[var(--gr-ink)] sm:text-4xl">
              Open discovery — anyone&apos;s agent, not only ours
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--gr-ink-2)]">
              Read directly from the registry contract{" "}
              <code className="font-mono text-xs">{short(IDENTITY_REGISTRY, 12, 6)}</code>. No submission form, no
              database, no approval step — if someone minted an identity, it appears here. <strong>Listed is not
              vetted</strong>: GuardRail&apos;s own four listings are the curated set, and their scope is a live,
              verifiable Altana session.
            </p>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-10">
        {error ? (
          <div className="rounded-2xl border border-[var(--gr-dead)]/30 bg-[var(--gr-dead-soft)] p-6">
            <h2 className="font-display text-lg font-semibold text-[var(--gr-ink)]">Registry read failed</h2>
            <p className="mt-2 font-mono text-xs text-[var(--gr-ink-2)]">{error}</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-[var(--gr-live-soft)] px-3 py-1 font-mono text-xs font-medium text-[var(--gr-live)]">
                {live} registered id(s)
              </span>
              <span className="font-mono text-xs text-[var(--gr-ink-3)]">
                scanned ids {scanned[0]}–{scanned[1]}
              </span>
              <Link href="/registry" className="gr-link font-mono text-xs font-semibold text-[var(--gr-magenta)]">
                reset
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {agents.map((a) => (
                <article
                  key={a.agentId}
                  className={`rounded-2xl border p-5 ${
                    a.ours ? "border-[var(--gr-magenta)]/40 bg-[var(--gr-magenta)]/5" : "border-[var(--gr-border)] bg-[var(--gr-surface)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-base font-semibold text-[var(--gr-ink)]">
                        {a.name ?? <span className="text-[var(--gr-ink-3)]">(no name in tokenURI)</span>}
                      </h3>
                      <p className="mt-0.5 font-mono text-[0.625rem] text-[var(--gr-ink-3)]">agent id {a.agentId}</p>
                    </div>
                    {a.ours ? (
                      <span className="rounded-md bg-[var(--gr-magenta)] px-2 py-0.5 font-mono text-[0.625rem] font-semibold text-white">
                        OURS
                      </span>
                    ) : (
                      <span className="rounded-md bg-[var(--gr-mono-chip)] px-2 py-0.5 font-mono text-[0.625rem] text-[var(--gr-ink-2)]">
                        third party
                      </span>
                    )}
                  </div>
                  {a.description ? (
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--gr-ink-2)]">{a.description}</p>
                  ) : null}
                  <p className="mt-2 font-mono text-[0.625rem] break-all text-[var(--gr-ink-3)]">
                    owner {short(a.owner)}
                  </p>
                  {a.services.length ? (
                    <ul className="mt-2 space-y-0.5">
                      {a.services.slice(0, 3).map((s, i) => (
                        <li key={i} className="truncate font-mono text-[0.625rem] text-[var(--gr-ink-2)]">
                          {s.name ?? "svc"}: {s.endpoint ?? "—"}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {a.guardrailScope ? (
                    <p className="mt-2 rounded bg-[var(--gr-live-soft)] px-2 py-1 font-mono text-[0.625rem] text-[var(--gr-live)]">
                      scope: {a.guardrailScope}
                    </p>
                  ) : null}
                  {a.ours ? (
                    <Link
                      href={`/verify?id=${OWN_LISTING_BY_ID[a.agentId] ?? 1}`}
                      className="mt-3 inline-block rounded-md border border-[var(--gr-magenta)]/40 px-2 py-1 font-mono text-[0.625rem] font-semibold text-[var(--gr-magenta)]"
                    >
                      ⛨ scope certificate ↗
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>

            {agents.length === 0 ? (
              <p className="font-mono text-sm text-[var(--gr-ink-3)]">No agents found in the scanned id window.</p>
            ) : null}
          </>
        )}

        <p className="mt-8 font-mono text-xs text-[var(--gr-ink-3)]">
          Enumeration note: the registry implements neither <code>totalSupply()</code> nor ERC-721 Enumerable, and public
          BSC RPCs reject <code>eth_getLogs</code> — so this page probes a bounded id window with <code>ownerOf</code> and
          reads each <code>tokenURI</code>. Ids that are not minted are skipped (the call reverts). Machine-readable:{" "}
          <code>/api/registry?from=&amp;to=</code>
        </p>
      </section>
    </main>
  );
}
