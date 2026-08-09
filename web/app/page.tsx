"use client";

import { useReadContract, useReadContracts } from "wagmi";
import {
  MARKETPLACE,
  MARKETPLACE_ABI,
  CATEGORIES,
  DEMO_AGENT_WALLET,
  KEYSTORE_ABI,
  ALTANA_KEYSTORE,
} from "@/lib/guardrail";
import { keccak256 } from "viem";
import { HireButton } from "@/components/HireButton";
import { BuyReportButton } from "@/components/BuyReportButton";

// wagmi reads are client-side and chain-dependent, so skip static prerender.
export const dynamic = "force-dynamic";

const CATEGORY_NAMES = ["Rebalancing", "Grid Trading", "Yield Optimisation", "Health Factor Monitoring"];

function LiveBadge({ live }: { live: boolean | undefined }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium " +
        (live === undefined
          ? "bg-zinc-100 text-zinc-500"
          : live
            ? "bg-emerald-50 text-emerald-700"
            : "bg-red-50 text-red-700")
      }
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (live === undefined ? "bg-zinc-400" : live ? "bg-emerald-500" : "bg-red-500")
        }
      />
      {live === undefined ? "checking" : live ? "session live" : "session dead"}
    </span>
  );
}

const KIND_BY_CATEGORY = ["lp", "grid", "yield", "health"] as const;

function AgentCard({
  name,
  category,
  wallet,
  live,
  id,
  categoryIndex,
}: {
  name: string;
  category: string;
  wallet: string;
  live: boolean | undefined;
  id: bigint;
  categoryIndex: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-zinc-900">{name}</h3>
          <p className="text-sm text-zinc-500">{category}</p>
        </div>
        <LiveBadge live={live} />
      </div>
      <p className="font-mono text-xs text-zinc-400 break-all">
        {wallet.slice(0, 10)}…{wallet.slice(-6)} · listing #{id.toString()}
      </p>
      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <HireButton provider={wallet} agentName={name} />
          <BuyReportButton kind={KIND_BY_CATEGORY[categoryIndex] ?? "health"} agentName={name} />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { data: count } = useReadContract({
    address: MARKETPLACE,
    abi: MARKETPLACE_ABI,
    functionName: "listingCount",
    query: { refetchInterval: 15_000 },
  });

  const liveCount = count !== undefined ? Number(count) : 0;

  // One summary + verifyLive per listing id.
  const summaries = useReadContracts({
    contracts: Array.from({ length: liveCount }, (_, i) => ({
      address: MARKETPLACE,
      abi: MARKETPLACE_ABI,
      functionName: "listingSummary",
      args: [BigInt(i + 1)],
    })),
    query: { refetchInterval: 15_000, enabled: liveCount > 0 },
  });

  const verifies = useReadContracts({
    contracts: Array.from({ length: liveCount }, (_, i) => ({
      address: MARKETPLACE,
      abi: MARKETPLACE_ABI,
      functionName: "verifyLive",
      args: [BigInt(i + 1)],
    })),
    query: { refetchInterval: 15_000, enabled: liveCount > 0 },
  });

  // Direct KeyStore check for the demo wallet: proves anyone can verify an
  // agent's authority with a plain read, marketplace not required.
  const { data: demoKeyLive } = useReadContract({
    address: ALTANA_KEYSTORE,
    abi: KEYSTORE_ABI,
    functionName: "isValidKey",
    args: [
      DEMO_AGENT_WALLET,
      "0xd3627c9ab2a0b45751fe0cd32150b1124239bfcc830ddcef1b190bcfdd07288a" as `0x${string}`,
    ],
    query: { refetchInterval: 15_000 },
  });

  const cards = [];
  if (summaries.data && verifies.data) {
    for (let i = 0; i < liveCount; i++) {
      const s = summaries.data[i]?.result as
        | readonly [bigint, number, string, `0x${string}`, `0x${string}`, `0x${string}`, bigint]
        | undefined;
      const v = verifies.data[i]?.result as boolean | undefined;
      if (!s || v === undefined) continue;
      const id = s[0];
      const category = Number(s[1]);
      if (category > 3) continue; // deleted listings are pruned from reads
      cards.push(
        <AgentCard
          key={id.toString()}
          id={id}
          name={s[2]}
          category={CATEGORY_NAMES[category]}
          categoryIndex={category}
          wallet={s[3]}
          live={v}
        />,
      );
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">G</span>
            <span className="text-lg font-semibold tracking-tight">GuardRail</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">BSC testnet</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <span>Altana KeyStore</span>
            <span className="font-mono text-xs">{ALTANA_KEYSTORE.slice(0, 12)}…</span>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-12 pb-8">
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-zinc-900">
          Agents that can only act inside the limits you set
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-600">
          Every agent on GuardRail runs from its own self-custodial wallet with a scoped session:
          a call allowlist, a spend cap and an expiry, all enforced onchain. Revoke it with one
          transaction and the listing dies instantly. No unbounded approvals, ever.
        </p>
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
          <span className="text-zinc-500">Marketplace contract:</span>
          <span className="font-mono text-xs text-zinc-400">{MARKETPLACE}</span>
          <LiveBadge live={demoKeyLive} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <h2 className="mb-4 text-sm font-medium tracking-wide text-zinc-500 uppercase">Categories</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map((c) => (
            <div key={c.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
              <span className="text-xs font-medium text-zinc-400">0{c.id + 1}</span>
              <h3 className="mt-1 font-semibold text-zinc-900">{c.name}</h3>
              <p className="mt-1 text-sm text-zinc-500">{c.blurb}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-10 mb-4 text-sm font-medium tracking-wide text-zinc-500 uppercase">
          Live agents on BSC testnet · {count?.toString() ?? "…"} listing(s)
        </h2>
        {cards.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards}</div>
        ) : (
          <p className="text-sm text-zinc-400">Loading listings…</p>
        )}

        <p className="mt-6 text-xs text-zinc-400">
          Every card is a live GuardRailMarketplace listing backed by an Altana KeyStore session key.
          verifyLive() reads the real KeyStore on every refresh: revoke an agent's session onchain and
          its card flips to session dead within one poll.
        </p>
      </section>
    </main>
  );
}
