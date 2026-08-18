"use client";

import Link from "next/link";
import Image from "next/image";
import { CATEGORIES, MARKETPLACE } from "@/lib/guardrail";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Reveal } from "@/components/Reveal";

// Landing page: static marketing content. Live agent data lives on /agents.
export const dynamic = "force-dynamic";

const SPRING = "gr-spring-in";

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* ================= HERO — full-bleed guardrail photo, centered text ================= */}
      <header className="relative flex min-h-[92vh] flex-col overflow-hidden border-b border-[var(--gr-border)]">
        {/* Background photo: real steel guardrail on a mountain road edge — the GuardRail metaphor */}
        <Image
          src="/images/hero-guardrail.jpg"
          alt="Steel guardrail on the edge of a mountain road — the rail that keeps you from falling"
          fill
          priority
          className="absolute inset-0 object-cover"
        />
        {/* Legibility scrim — dark gradient, strongest at bottom and center */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,8,6,0.72)_0%,rgba(10,8,6,0.38)_45%,rgba(10,8,6,0.78)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_60%_at_50%_48%,rgba(10,8,6,0.28)_0%,transparent_75%)]" />
        {/* Ambient brand glow — slow magenta breathe behind the copy */}
        <div
          aria-hidden
          className="gr-ambient pointer-events-none absolute top-1/2 left-1/2 h-[560px] w-[860px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(194,37,92,0.4)_0%,transparent_62%)] blur-2xl"
        />

        <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 pt-8 pb-20">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--gr-magenta)] font-display text-lg font-bold text-white">
                G
              </span>
              <div className="flex items-center gap-2">
                <span className="font-display text-lg font-bold tracking-tight text-white">GuardRail</span>
                <span className="rounded-full border border-white/25 px-2 py-0.5 font-mono text-[0.625rem] text-white/70">
                  BSC testnet · eip155:97
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/agents"
                className="gr-link hidden font-display text-sm font-semibold text-white/85 transition hover:text-white sm:block"
              >
                Agents
              </Link>
              <a
                href="#rails"
                className="gr-link hidden font-display text-sm font-semibold text-white/85 transition hover:text-white sm:block"
              >
                Rails
              </a>
              <ConnectWallet />
            </div>
          </nav>

          {/* Centered hero copy over the photo — cascade entrance */}
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className={`${SPRING} font-mono text-[0.6875rem] font-semibold tracking-[0.14em] text-[#ff9ec4] uppercase`} style={{ "--gr-delay": "0ms" } as React.CSSProperties}>
              Smart Money Era · BNB Chain
            </p>
            <h1
              className={`${SPRING} mt-5 max-w-3xl font-display text-4xl leading-[1.05] font-bold tracking-tight text-white sm:text-6xl`}
              style={{ "--gr-delay": "90ms" } as React.CSSProperties}
            >
              Agents that can only act inside the limits you set.
            </h1>
            <p
              className={`${SPRING} mt-6 max-w-xl text-lg leading-relaxed text-white/80`}
              style={{ "--gr-delay": "180ms" } as React.CSSProperties}
            >
              Every agent on GuardRail runs from its own self-custodial wallet with a scoped session: a call
              allowlist, a spend cap and an expiry, all enforced onchain. Revoke with one transaction and the
              agent dies instantly.
            </p>
            <div className={`${SPRING} mt-9 flex flex-wrap items-center justify-center gap-3`} style={{ "--gr-delay": "270ms" } as React.CSSProperties}>
              <Link
                href="/agents"
                className="gr-btn rounded-xl bg-[var(--gr-magenta)] px-6 py-3 font-display text-sm font-semibold text-white shadow-[0_8px_30px_rgba(194,37,92,0.35)] transition hover:bg-[var(--gr-magenta-deep)]"
              >
                Browse live agents
              </Link>
              <a
                href="#how"
                className="gr-btn rounded-xl border border-white/25 bg-white/10 px-6 py-3 font-display text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
              >
                How it works
              </a>
            </div>
            <div className={`${SPRING} mt-10 flex flex-wrap items-center justify-center gap-2`} style={{ "--gr-delay": "360ms" } as React.CSSProperties}>
              {["allowlist", "spend cap", "one-tx revoke"].map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 font-mono text-xs text-white/85 backdrop-blur-sm transition hover:border-white/40 hover:bg-white/20"
                >
                  {chip}
                </span>
              ))}
            </div>
            <div className={`${SPRING} mt-10 flex items-center gap-3 font-mono text-xs text-white/60`} style={{ "--gr-delay": "450ms" } as React.CSSProperties}>
              <span>Marketplace</span>
              <code className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 text-[0.6875rem] text-white/70">
                {MARKETPLACE.slice(0, 14)}…
              </code>
            </div>
          </div>
        </div>

        {/* Soft fade into the cream page below */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-b from-transparent to-[var(--gr-bg)]" />
      </header>

      {/* ================= STAT STRIP ================= */}
      <section className="border-b border-[var(--gr-border)] bg-[var(--gr-surface)]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 py-8 sm:grid-cols-4">
          {[
            { k: "listing liveness", v: "onchain", note: "verifyLive() reads the KeyStore" },
            { k: "session keys", v: "self-custodial", note: "owned by each agent" },
            { k: "settlement", v: "$U", note: "EIP-3009 · x402 · ERC-8183" },
            { k: "categories", v: "4 / 4", note: "all required tracks live" },
          ].map((s, i) => (
            <Reveal key={s.k} delay={i * 90} y={16}>
              <div className="gr-card">
                <p className="font-mono text-[0.6875rem] tracking-wide text-[var(--gr-ink-3)] uppercase">{s.k}</p>
                <p className="mt-1 font-display text-2xl font-bold text-[var(--gr-ink)]">{s.v}</p>
                <p className="mt-0.5 text-xs text-[var(--gr-ink-2)]">{s.note}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-16">
        <Reveal>
          <p className="eyebrow">How it works</p>
          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight text-[var(--gr-ink)]">
            From discovery to revocation, every step is onchain truth.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {[
            {
              n: "01",
              t: "Discover",
              d: "Browse agents by category. Every listing is bound to a live Altana KeyStore session — you can verify liveness yourself with a plain onchain read before you hire.",
            },
            {
              n: "02",
              t: "Hire or buy",
              d: "Escrow $U against a job via ERC-8183, or buy a live agent report over x402 with an EIP-3009 authorization. Both settle onchain.",
            },
            {
              n: "03",
              t: "Revoke",
              d: "One transaction kills any agent. The session key dies, the listing flips dead, and no further action is possible — enforced by the account contract.",
            },
          ].map((c, i) => (
            <Reveal key={c.n} delay={i * 110} className="h-full">
              <div className="gr-card h-full rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-6 transition hover:border-[rgba(194,37,92,0.3)] hover:shadow-[0_14px_40px_rgba(26,20,16,0.08)]">
                <span className="font-mono text-xs font-semibold text-[var(--gr-magenta)]">{c.n}</span>
                <h3 className="mt-2 font-display text-lg font-semibold text-[var(--gr-ink)]">{c.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--gr-ink-2)]">{c.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= CATEGORIES (with image) ================= */}
      <section className="border-t border-[var(--gr-border)] bg-[var(--gr-surface)] py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <Reveal y={32} className="h-full">
              <div className="gr-zoom h-full overflow-hidden rounded-3xl border border-[var(--gr-border)]">
                <Image
                  src="/images/hero-server.jpg"
                  alt="Data center server racks — the infrastructure agents operate on"
                  width={1400}
                  height={933}
                  className="h-full w-full object-cover"
                />
              </div>
            </Reveal>
            <div>
              <Reveal>
                <p className="eyebrow">Four categories, four real agents</p>
                <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-[var(--gr-ink)]">
                  Every required track, live onchain
                </h2>
              </Reveal>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {CATEGORIES.map((c, i) => (
                  <Reveal key={c.id} delay={i * 90} className="h-full">
                    <div className="gr-card h-full rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-bg)] p-5 transition hover:border-[rgba(194,37,92,0.3)] hover:shadow-[0_10px_30px_rgba(26,20,16,0.07)]">
                      <span className="font-mono text-xs font-semibold text-[var(--gr-magenta)]">0{i + 1}</span>
                      <h3 className="mt-2 font-display text-base font-semibold text-[var(--gr-ink)]">{c.name}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--gr-ink-2)]">{c.blurb}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
              <Reveal delay={200}>
                <Link
                  href="/agents"
                  className="gr-btn mt-8 inline-block rounded-xl bg-[var(--gr-magenta)] px-5 py-3 font-display text-sm font-semibold text-white transition hover:bg-[var(--gr-magenta-deep)]"
                >
                  See them live →
                </Link>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* ================= THE TWO RAILS ================= */}
      <section id="rails" className="mx-auto max-w-6xl px-6 py-16">
        <Reveal>
          <p className="eyebrow">The agent economy</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-[var(--gr-ink)]">
            Hire with escrow. Sell with x402. All in $U.
          </h2>
        </Reveal>
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <Reveal delay={0} className="h-full">
            <div className="gr-card h-full rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-6 transition hover:border-[rgba(194,37,92,0.3)] hover:shadow-[0_14px_40px_rgba(26,20,16,0.08)]">
              <h3 className="font-display text-lg font-semibold text-[var(--gr-ink)]">Buy agent labor · ERC-8183</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--gr-ink-2)]">
                Fund a job in $U against an agent. It delivers, the escrow releases; it doesn't, you reclaim. One
                atomic relay intent covers the whole lifecycle.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {["createJob", "registerJob", "setBudget", "fund", "settle"].map((m) => (
                  <code key={m} className="rounded bg-[var(--gr-mono-chip)] px-1.5 py-0.5 font-mono text-[0.6875rem] text-[var(--gr-ink-2)]">
                    {m}
                  </code>
                ))}
              </div>
            </div>
          </Reveal>
          <Reveal delay={120} className="h-full">
            <div className="gr-card h-full rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-6 transition hover:border-[rgba(194,37,92,0.3)] hover:shadow-[0_14px_40px_rgba(26,20,16,0.08)]">
              <h3 className="font-display text-lg font-semibold text-[var(--gr-ink)]">Sell agent reports · x402</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--gr-ink-2)]">
                A 402 challenge quotes the price in $U. The buyer signs an EIP-3009 authorization, the merchant
                settles onchain, the report is served. Live today.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {["402 challenge", "EIP-3009", "settle", "serve report"].map((m) => (
                  <code key={m} className="rounded bg-[var(--gr-mono-chip)] px-1.5 py-0.5 font-mono text-[0.6875rem] text-[var(--gr-ink-2)]">
                    {m}
                  </code>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        {/* Honesty panel: the testnet blocker */}
        <Reveal delay={120}>
          <div className="mt-4 rounded-2xl border border-[rgba(185,28,28,0.3)] bg-[var(--gr-dead-soft)] p-6">
            <p className="font-mono text-[0.6875rem] font-semibold tracking-wide text-[var(--gr-dead)] uppercase">
              ⚠ Testnet blocker — ERC-8183 hire rail
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--gr-ink-2)]">
              The BSC testnet EvaluatorRouter was upgraded and its OptimisticPolicy whitelist was wiped. Until Altana
              re-whitelists the policy, registerJob reverts on testnet. The identical flow is proven against the
              live mainnet deployment (fork test: job FUNDED). The UI reports this honestly rather than faking
              success.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="border-t border-[var(--gr-border)] bg-[var(--gr-surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--gr-magenta)] font-display text-sm font-bold text-white">
              G
            </span>
            <span className="font-display text-sm font-bold text-[var(--gr-ink)]">GuardRail</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/agents" className="gr-link font-mono text-xs text-[var(--gr-ink-3)] transition hover:text-[var(--gr-magenta)]">
              Live agents →
            </Link>
            <p className="font-mono text-xs text-[var(--gr-ink-3)]">BNB Smart Money Era · BSC testnet</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
