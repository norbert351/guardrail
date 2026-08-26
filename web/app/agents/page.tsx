"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useWalletClient } from "wagmi";
import { ALTANA_KEYSTORE, MARKETPLACE, MARKETPLACE_ABI } from "@/lib/guardrail";
import { capLabel, clampScore, trustScoreLabel, type ScopeCap } from "@/lib/format";
import { HireButton } from "@/components/HireButton";
import { BuyReportButton } from "@/components/BuyReportButton";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Reveal } from "@/components/Reveal";
import { Logomark } from "@/components/Logomark";
import { SafetyProof } from "@/components/SafetyProof";

export const dynamic = "force-dynamic";

const CATEGORY_NAMES = ["Rebalancing", "Grid Trading", "Yield Optimisation", "Health Factor Monitoring"];
const KIND_BY_CATEGORY = ["lp", "grid", "yield", "health"] as const;
// GuardRail's 4 agent identities on the ERC-8004 registry (per listing index).
const IDENTITY_BY_CATEGORY = [1790, 1791, 1792, 1793] as const;
const SCAN = "https://8004scan.io/agents";

type Listing = {
  id: number;
  category: number;
  name: string;
  agentWallet: `0x${string}`;
  sessionKeyId: string;
  operator: `0x${string}`;
  listedAt: number;
  live: boolean;
  active: boolean;
  allowlist: string[];
  trustScore: number;
  cap?: ScopeCap;
};

type AgentMetrics = {
  chain?: string;
  updatedAt?: string;
  agents?: {
    lp?: { name?: string; category?: string; priceUsdPerWbnb?: number; lpTokenBal?: string; lpSharePct?: number };
    grid?: { name?: string; category?: string; priceUsdPerWbnb?: number; gridBuy?: number; gridSell?: number; stepPct?: number };
    yield?: { name?: string; category?: string; venue?: string; apyPct?: number };
    health?: { name?: string; category?: string; positionUsd?: string; supplyApyPct?: number; healthFactor?: number };
  };
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

function MetricRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--gr-bg)] px-2.5 py-1.5">
      <span className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">{label}</span>
      <span className={`font-mono text-xs font-semibold ${accent ? "text-[var(--gr-magenta)]" : "text-[var(--gr-ink)]"}`}>
        {value}
      </span>
    </div>
  );
}

function renderMetrics(categoryIndex: number, metrics: AgentMetrics["agents"] | undefined) {
  const pad = (n: number | undefined, d = 2) => (n === undefined || Number.isNaN(n) ? "—" : n.toFixed(d));
  const rows: [string, string, boolean?][] = [];
  if (categoryIndex === 0) {
    const lp = metrics?.lp;
    rows.push(["Live price (USDT/WBNB)", pad(lp?.priceUsdPerWbnb), true]);
    rows.push(["LP token balance", lp?.lpTokenBal !== undefined ? Number(lp.lpTokenBal).toFixed(4) : "—"]);
    rows.push(["Pool share", lp?.lpSharePct !== undefined ? `${lp.lpSharePct.toFixed(4)}%` : "—"]);
  } else if (categoryIndex === 1) {
    const g = metrics?.grid;
    rows.push(["Live price (USDT/WBNB)", pad(g?.priceUsdPerWbnb), true]);
    rows.push(["Grid buy level", pad(g?.gridBuy)]);
    rows.push(["Grid sell level", pad(g?.gridSell)]);
    rows.push(["Grid step", g?.stepPct ? `±${g.stepPct}%` : "±5%"]);
  } else if (categoryIndex === 2) {
    const y = metrics?.yield;
    rows.push(["Best market", y?.venue ?? "—", true]);
    rows.push(["Supply APY", y?.apyPct !== undefined ? `${y.apyPct.toFixed(2)}%` : "—"]);
  } else if (categoryIndex === 3) {
    const h = metrics?.health;
    rows.push(["Position (vUSDT USDT)", h?.positionUsd !== undefined ? `$${h.positionUsd}` : "—", true]);
    rows.push(["Supply APY", h?.supplyApyPct !== undefined ? `${h.supplyApyPct.toFixed(2)}%` : "—"]);
    rows.push(["Health factor", h?.healthFactor !== undefined ? h.healthFactor.toFixed(2) : "—"]);
  }
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(([label, value, accent]) => (
        <MetricRow key={label} label={label} value={value} accent={accent} />
      ))}
    </div>
  );
}

function TrustBadge({ score }: { score: number }) {
  const pct = clampScore(score);
  const label = trustScoreLabel(pct);
  return (
    <div className="flex items-center gap-2" title={`Onchain trust score: ${pct}/100`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--gr-mono-chip)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: `var(--gr-magenta)` }}
        />
      </div>
      <span className="font-mono text-xs font-semibold" style={{ color: `var(--gr-ink)` }}>
        {pct}
        <span className="text-[var(--gr-ink-3)]">/100</span>
      </span>
      <span className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]" style={{ color: `var(--gr-ink-3)` }}>
        · {label}
      </span>
    </div>
  );
}

const EXPLORER = "https://testnet.bscscan.com/tx/";

type OpResult = { hash?: string; error?: string };

function OperatorControls({ operator, id, active }: { operator: `0x${string}`; id: number; active: boolean }) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OpResult | null>(null);
  const [needWallet, setNeedWallet] = useState(false);

  const isOperator =
    isConnected && address !== undefined && address.toLowerCase() === operator.toLowerCase();

  if (!isOperator) return null;

  async function toggle() {
    setBusy(true);
    setResult(null);
    setNeedWallet(false);
    try {
      if (!walletClient || !address) {
        setNeedWallet(true);
        setResult({ error: "Connect the operator wallet first." });
        return;
      }
      const hash = await walletClient.writeContract({
        address: MARKETPLACE,
        abi: MARKETPLACE_ABI,
        functionName: "toggleActive",
        args: [BigInt(id), !active],
        account: address,
        chain: undefined as any,
      });
      setResult({ hash });
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setResult({ error: err.shortMessage ?? err.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function unlist() {
    setBusy(true);
    setResult(null);
    setNeedWallet(false);
    try {
      if (!walletClient || !address) {
        setNeedWallet(true);
        setResult({ error: "Connect the operator wallet first." });
        return;
      }
      const hash = await walletClient.writeContract({
        address: MARKETPLACE,
        abi: MARKETPLACE_ABI,
        functionName: "unlist",
        args: [BigInt(id)],
        account: address,
        chain: undefined as any,
      });
      setResult({ hash });
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setResult({ error: err.shortMessage ?? err.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--gr-border)] bg-[var(--gr-bg)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[0.6875rem] text-[var(--gr-ink-2)]">
          You are the operator of listing #{id}
        </p>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[0.625rem] font-medium ${active ? "bg-[var(--gr-live-soft)] text-[var(--gr-live)]" : "bg-[var(--gr-warn-soft)] text-[var(--gr-warn)]"}`}>
          {active ? "listed" : "paused"}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <button
          onClick={toggle}
          disabled={busy}
          className="rounded-lg border border-[var(--gr-border)] px-3 py-1.5 text-sm font-medium text-[var(--gr-ink)] transition hover:border-[var(--gr-magenta)] hover:text-[var(--gr-magenta)] disabled:opacity-50"
        >
          {needWallet && !isConnected ? "Connect wallet to manage" : active ? "Pause listing" : "Resume listing"}
        </button>
        <button
          onClick={unlist}
          disabled={busy}
          className="rounded-lg border border-[var(--gr-dead)]/40 px-3 py-1.5 text-sm font-medium text-[var(--gr-dead)] transition hover:bg-[var(--gr-dead-soft)] disabled:opacity-50"
        >
          Unlist
        </button>
      </div>
      {result && (
        <div className="mt-2 rounded-lg border border-[var(--gr-border)] bg-[var(--gr-surface)] p-2 text-xs">
          {result.hash ? (
            <>
              <p className="font-medium text-emerald-700">Sent · {active ? "paused" : "resumed"}/unlisted onchain</p>
              <a href={EXPLORER + result.hash} target="_blank" rel="noreferrer" className="block font-mono text-zinc-500 underline break-all">
                {result.hash.slice(0, 20)}…
              </a>
            </>
          ) : (
            <p className="text-[var(--gr-dead)]">{result.error}</p>
          )}
        </div>
      )}
    </div>
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
  trustScore,
  cap,
  metrics,
  operator,
  active,
  identityId,
}: {
  name: string;
  category: string;
  wallet: string;
  live: boolean;
  id: number;
  categoryIndex: number;
  allowlist: string[];
  trustScore: number;
  cap: Listing["cap"];
  metrics: AgentMetrics["agents"] | undefined;
  operator: `0x${string}`;
  active: boolean;
  identityId: number;
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
      <TrustBadge score={trustScore} />
      {identityId > 0 && (
        <a
          href={SCAN}
          target="_blank"
          rel="noreferrer"
          className="group/ident inline-flex items-center gap-1.5 rounded-md px-1 -mx-1 py-2 -my-1.5 font-mono text-[0.6875rem] text-[var(--gr-magenta)]"
        >
          ⬡ ERC-8004 identity #{identityId}
          <span className="transition group-hover/ident:underline">· 8004scan ↗</span>
        </a>
      )}
      {allowlist.length > 0 && (
        <p className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">
          allowlist: {allowlist.map((a) => `${a.slice(0, 6)}…${a.slice(-4)}`).join(", ")}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        {capLabel(cap) && (
          <p className="font-mono text-[0.6875rem] text-[var(--gr-live)]">{capLabel(cap)}</p>
        )}
        <p className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">op: {operator.slice(0, 6)}…{operator.slice(-4)}</p>
      </div>
      <p className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">free to list · scope enforced onchain</p>
      {renderMetrics(categoryIndex, metrics)}
      <div className="mt-auto flex flex-col gap-3 border-t border-[var(--gr-border)] pt-4">
        <div className="flex items-center gap-2">
          <HireButton provider={wallet} agentName={name} listingId={id} />
          <BuyReportButton kind={KIND_BY_CATEGORY[categoryIndex] ?? "health"} agentName={name} />
        </div>
        <OperatorControls operator={operator} id={id} active={active} />
      </div>
    </article>
  );
}

export default function AgentsPage() {
  const [data, setData] = useState<{ listingCount: number; listings: Listing[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<AgentMetrics["agents"] | undefined>(undefined);

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

  // Live metrics (data quality layer) — refreshed less aggressively than the
  // listings so the onchain reads don't hammer the RPC, but stays current.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/agent-metrics");
        if (!res.ok) return;
        const json = (await res.json()) as AgentMetrics;
        if (!cancelled) setMetrics(json.agents);
      } catch {
        /* metrics are best-effort */
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const { data: demoKeyLive } = { data: undefined };

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
          trustScore={l.trustScore}
          cap={l.cap}
          metrics={metrics}
          operator={l.operator}
          active={l.active}
          identityId={l.category >= 0 && l.category <= 3 ? IDENTITY_BY_CATEGORY[l.category] as number : 0}
        />
      </Reveal>
    ));

  return (
    <main className="min-h-screen">
      <header className="border-b border-[var(--gr-border)] bg-[var(--gr-bg)]">
        <div className="mx-auto max-w-6xl px-6 pt-8 pb-10">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Logomark />
              <span className="font-display text-lg font-bold tracking-tight text-[var(--gr-ink)]">GuardRail</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/" className="gr-link hidden font-display text-sm font-semibold text-[var(--gr-ink)] transition hover:text-[var(--gr-magenta)] sm:block">
                Home
              </Link>
              <Link href="/list" className="hidden rounded-lg bg-[var(--gr-magenta)] px-3 py-1.5 font-display text-sm font-semibold text-white transition hover:bg-[var(--gr-magenta-deep)] sm:block">
                List agent
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
                {data ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--gr-live-soft)] px-2.5 py-0.5 font-mono text-[0.6875rem] font-medium text-[var(--gr-live)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--gr-live)]" />
                    {live} of {listings.length} sessions live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-200 px-2.5 py-0.5 font-mono text-[0.6875rem] font-medium text-zinc-500">
                    checking…
                  </span>
                )}
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

      <SafetyProof />

      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-6 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-display text-lg font-bold text-[var(--gr-ink)]">Run an agent? List it here for free.</h3>
            <p className="mt-1 text-sm text-[var(--gr-ink-2)]">
              Any agent with a live scoped session can join the marketplace. Your scope is enforced onchain.
            </p>
          </div>
          <Link
            href="/list"
            className="shrink-0 rounded-xl bg-[var(--gr-magenta)] px-5 py-2.5 font-display text-sm font-semibold text-white shadow-[0_8px_30px_rgba(194,37,92,0.3)] transition hover:bg-[var(--gr-magenta-deep)]"
          >
            List your agent →
          </Link>
        </div>
      </section>

      <footer className="mt-8 border-t border-[var(--gr-border)] bg-[var(--gr-surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-center gap-2">
            <Logomark className="h-7 w-7" />
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
