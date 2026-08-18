"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useReadContract } from "wagmi";
import { KEYSTORE_ABI, ALTANA_KEYSTORE } from "@/lib/guardrail";
import { HireButton } from "@/components/HireButton";
import { BuyReportButton } from "@/components/BuyReportButton";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Reveal } from "@/components/Reveal";

export const dynamic = "force-dynamic";

const CATEGORY_NAMES = ["Rebalancing", "Grid Trading", "Yield Optimisation", "Health Factor Monitoring"];
const KIND_BY_CATEGORY = ["lp", "grid", "yield", "health"] as const;

type Listing = {
  id: number;
  category: number;
  name: string;
  agentWallet: `0x${string}`;
  sessionKeyId: string;
  operator: `0x${string}`;
  listedAt: number;
  live: boolean;
  allowlist: string[];
};

function LiveBadge({ live }: { live: boolean | undefined }) {
  const state =
    live === undefined
      ? { label: "checking", cls: "bg-zinc-200 text-zinc-500", dot: "bg-zinc-400" }
      : live
        ? { label: "session live", cls: "bg-[var(--gr-live-soft)] text-[var(--gr-live)]", dot: "bg-[var(--gr-live)]" }
        : { label: "session dead", cls: "bg-[var(--gr-dead-soft)] text-[var(--gr-dead)]", dot: "bg-[var(--gr-dead)]" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[0.6875rem] font-medium ${state.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${state.dot}`} />
      {state.label}
    </span>
  );
}

function AgentCard({
  name,
  category,
  wallet,
  live,
  id,
  categoryIndex,
  allowlist,
}: {
  name: string;
  category: string;
  wallet: string;
  live: boolean;
  id: number;
  categoryIndex: number;
  allowlist: string[];
}) {
  return (
    <article className="gr-card group flex h-full flex-col gap-4 rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-6 shadow-[0_1px_2px_rgba(26,20,16,0.04)] transition hover:border-[rgba(194,37,92,0.35)] hover:shadow-[0_8px_30px_rgba(26,20,16,0.07)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-[var(--gr-ink)]">{name}</h3>
          <p className="mt-0.5 text-sm text-[var(--gr-ink-2)]">{category}</p>
        </div>
        <LiveBadge live={live} />
      </div>
      <p className="font-mono text-xs text-[var(--gr-ink-3)] break-all">
        {wallet.slice(0, 10)}…{wallet.slice(-6)} · listing #{id}
      </p>
      {allowlist.length > 0 && (
        <p className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">
          allowlist: {allowlist.map((a) => `${a.slice(0, 6)}…${a.slice(-4)}`).join(", ")}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-3 border-t border-[var(--gr-border)] pt-4">
        <div className="flex items-center gap-2">
          <HireButton provider={wallet} agentName={name} />
          <BuyReportButton kind={KIND_BY_CATEGORY[categoryIndex] ?? "health"} agentName={name} />
        </div>
      </div>
    </article>
  );
}

export default function AgentsPage() {
  const [data, setData] = useState<{ listingCount: number; listings: Listing[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/listings");
        if (!res.ok) throw new Error("listings fetch failed");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const { data: demoKeyLive } = useReadContract({
    address: ALTANA_KEYSTORE,
    abi: KEYSTORE_ABI,
    functionName: "isValidKey",
    args: ["0xa847F3BBF69E8A888b59BC8729ce787E0dB5be97" as `0x${string}`, "0xd3627c9ab2a0b45751fe0cd32150b1124239bfcc830ddcef1b190bcfdd07288a" as `0x${string}`],
    query: { refetchInterval: 15_000 },
  });

  const listings = data?.listings ?? [];
  const live = listings.filter((l) => l.live).length;
  const cards = listings
    .filter((l) => l.category >= 0 && l.category <= 3)
    .map((l, idx) => (
      <Reveal key={l.id} delay={(idx % 6) * 80} className="h-full">
        <AgentCard
          id={l.id}
          name={l.name}
          category={CATEGORY_NAMES[l.category]}
          categoryIndex={l.category}
          wallet={l.agentWallet}
          live={l.live}
          allowlist={l.allowlist}
        />
      </Reveal>
    ));

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--gr-border)] bg-[var(--gr-bg)]">
        <div className="mx-auto max-w-6xl px-6 pt-8 pb-10">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--gr-magenta)] font-display text-lg font-bold text-white">
                G
              </span>
              <span className="font-display text-lg font-bold tracking-tight text-[var(--gr-ink)]">GuardRail</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/" className="gr-link font-display text-sm font-semibold text-[var(--gr-ink)] transition hover:text-[var(--gr-magenta)]">
                Home
              </Link>
              <ConnectWallet />
            </div>
          </nav>
          <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Live agents on BSC testnet</p>
              <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[var(--gr-ink)] sm:text-4xl">
                {data ? `${listings.length} listing(s) · ${live} live` : "Loading…"}
              </h1>
            </div>
            <div className="max-w-md">
              <p className="text-sm leading-relaxed text-[var(--gr-ink-2)]">
                Every card is bound to a live Altana KeyStore session. verifyLive() reads the real KeyStore — revoke an
                agent onchain and its card flips to session dead.
              </p>
              <div className="mt-3 flex items-center gap-2 font-mono text-xs text-[var(--gr-ink-2)]">
                <span>KeyStore</span>
                <code className="rounded bg-[var(--gr-mono-chip)] px-1.5 py-0.5 text-[0.6875rem]">{ALTANA_KEYSTORE.slice(0, 14)}…</code>
                <LiveBadge live={demoKeyLive} />
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10">
        {error ? (
          <p className="font-mono text-sm text-[var(--gr-dead)]">Failed to read marketplace: {error}</p>
        ) : cards.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{cards}</div>
        ) : (
          <p className="font-mono text-sm text-[var(--gr-ink-3)]">Loading listings…</p>
        )}
      </section>

      <footer className="mt-8 border-t border-[var(--gr-border)] bg-[var(--gr-surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--gr-magenta)] font-display text-sm font-bold text-white">
              G
            </span>
            <span className="font-display text-sm font-bold text-[var(--gr-ink)]">GuardRail</span>
          </div>
          <p className="font-mono text-xs text-[var(--gr-ink-3)]">
            BNB Smart Money Era · BSC testnet · github.com/norbert351/guardrail
          </p>
        </div>
      </footer>
    </main>
  );
}
