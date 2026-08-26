"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { isAddress } from "viem";
import {
  ALTANA_KEYSTORE,
  CATEGORIES,
  KEYSTORE_ABI,
  MARKETPLACE,
} from "@/lib/guardrail";
import { ConnectWallet } from "@/components/ConnectWallet";
import { Logomark } from "@/components/Logomark";
import { Reveal } from "@/components/Reveal";

const EXPLORER = "https://testnet.bscscan.com/tx/";
const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const PERIODS = [
  { label: "per day", value: 86400n },
  { label: "per week", value: 604800n },
  { label: "per month", value: 2592000n },
];

export const dynamic = "force-dynamic";

const field =
  "w-full rounded-lg border border-[var(--gr-border)] bg-[var(--gr-surface)] px-3 py-2 text-sm text-[var(--gr-ink)] outline-none transition placeholder:text-[var(--gr-ink-3)] focus:border-[var(--gr-magenta)]";

function isBytes32(v: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

export default function ListPage() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [name, setName] = useState("");
  const [category, setCategory] = useState(0);
  const [agentWallet, setAgentWallet] = useState("");
  const [sessionKeyId, setSessionKeyId] = useState("");
  const [capLimit, setCapLimit] = useState("0.02");
  const [period, setPeriod] = useState<bigint>(86400n);
  const [allowlist, setAllowlist] = useState("");

  const [live, setLive] = useState<boolean | "checking" | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ hash?: string; error?: string } | null>(null);
  const [needWallet, setNeedWallet] = useState(false);

  // Live session check: read the Altana KeyStore directly.
  useEffect(() => {
    if (!publicClient) return;
    if (!isAddress(agentWallet) || !isBytes32(sessionKeyId)) {
      setLive(null);
      return;
    }
    let stale = false;
    setLive("checking");
    const t = setTimeout(async () => {
      try {
        const ok = (await publicClient.readContract({
          address: ALTANA_KEYSTORE,
          abi: KEYSTORE_ABI,
          functionName: "isValidKey",
          args: [agentWallet as `0x${string}`, sessionKeyId as `0x${string}`],
        })) as boolean;
        if (!stale) setLive(ok);
      } catch {
        if (!stale) setLive(null);
      }
    }, 500);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [agentWallet, sessionKeyId, publicClient]);

  const allowlistArr = useMemo<readonly `0x${string}`[]>(() => {
    return allowlist
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => !!s && isAddress(s)) as `0x${string}`[];
  }, [allowlist]);

  const valid =
    name.trim().length > 0 &&
    isAddress(agentWallet) &&
    isBytes32(sessionKeyId) &&
    parseFloat(capLimit) > 0 &&
    allowlistArr.length > 0;

  async function list() {
    setBusy(true);
    setResult(null);
    setNeedWallet(false);
    try {
      if (!isConnected || !walletClient || !address) {
        setNeedWallet(true);
        setResult({ error: "Connect your wallet to list your agent." });
        return;
      }
      if (!valid) {
        setResult({ error: "Fix the highlighted fields — allowlist, name, wallet and session key are required." });
        return;
      }
      const hash = await walletClient.writeContract({
        address: MARKETPLACE,
        abi: [
          {
            name: "list",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "category", type: "uint8" },
              { name: "name", type: "string" },
              { name: "agentWallet", type: "address" },
              { name: "sessionKeyId", type: "bytes32" },
              {
                name: "cap",
                type: "tuple",
                components: [
                  { name: "token", type: "address" },
                  { name: "limit", type: "uint256" },
                  { name: "period", type: "uint256" },
                ],
              },
              { name: "allowlist", type: "address[]" },
            ],
            outputs: [{ name: "id", type: "uint256" }],
          },
        ],
        functionName: "list",
        args: [
          category,
          name.trim(),
          agentWallet as `0x${string}`,
          sessionKeyId as `0x${string}`,
          { token: ZERO, limit: parseCap(capLimit), period },
          allowlistArr,
        ],
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
    <main className="min-h-screen">
      <header className="border-b border-[var(--gr-border)] bg-[var(--gr-bg)]">
        <div className="mx-auto max-w-6xl px-6 pt-8 pb-10">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <Logomark />
              <span className="font-display text-lg font-bold tracking-tight text-[var(--gr-ink)]">GuardRail</span>
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/" className="gr-link font-display text-sm font-semibold text-[var(--gr-ink)] transition hover:text-[var(--gr-magenta)]">
                Home
              </Link>
              <Link href="/agents" className="gr-link font-display text-sm font-semibold text-[var(--gr-ink)] transition hover:text-[var(--gr-magenta)]">
                Agents
              </Link>
              <span className="rounded-full bg-[var(--gr-magenta-soft)] px-3 py-1 font-display text-sm font-semibold text-[var(--gr-magenta)]">
                List agent
              </span>
              <ConnectWallet />
            </div>
          </nav>

          <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Self-serve marketplace</p>
              <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[var(--gr-ink)] sm:text-4xl">
                List your agent
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--gr-ink-2)]">
                Any agent with a live scoped session can list here — free. The marketplace verifies your session
                against the Altana KeyStore onchain, then surfaces your scope so buyers never have to trust your word.
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Three steps */}
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["01", "Run under a scoped session", "Your agent already lives in a self-custodial Altana smart account with a granted session: a call allowlist, a spend cap and an expiry. Listing only references that session."],
            ["02", "Connect your wallet", "You become the operator. Connect the wallet that controls the agent so a single revoke, pause or unlist is one signature away."],
            ["03", "Submit the scope onchain", "The marketplace records your category, name, live session key, cap and allowlist. Buyers can hire or buy your reports once it's live."],
          ].map(([n, t, d]) => (
            <div key={n} className="gr-card rounded-2xl p-5">
              <div className="font-mono text-xs font-semibold tracking-widest text-[var(--gr-magenta)]">{n}</div>
              <h3 className="mt-2 font-display text-lg font-bold text-[var(--gr-ink)]">{t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--gr-ink-2)]">{d}</p>
            </div>
          ))}
        </div>

        {/* Listing form */}
        <div className="mt-8 rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-6 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-xl font-bold text-[var(--gr-ink)]">Listing details</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--gr-live-soft)] px-2.5 py-1 font-mono text-xs font-medium text-[var(--gr-live)]">
              free to list · scope enforced onchain
            </span>
          </div>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {/* Name */}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--gr-ink-2)]">Agent name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="GuardRail Arb Bot" className={field} />
            </label>

            {/* Category */}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--gr-ink-2)]">Category</span>
              <select value={category} onChange={(e) => setCategory(Number(e.target.value))} className={field}>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Agent wallet */}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-[var(--gr-ink-2)]">Agent wallet (self-custodial)</span>
              <input value={agentWallet} onChange={(e) => setAgentWallet(e.target.value)} placeholder="0x…" className={`${field} font-mono`} />
            </label>

            {/* Session key id */}
            <label className="block sm:col-span-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--gr-ink-2)]">Session key id</span>
                {live && (
                  <span className="rounded-full bg-[var(--gr-live-soft)] px-2 py-0.5 font-mono text-[0.6875rem] font-medium text-[var(--gr-live)]">
                    session live ✓
                  </span>
                )}
                {live === false && (
                  <span className="rounded-full bg-[var(--gr-dead-soft)] px-2 py-0.5 font-mono text-[0.6875rem] font-medium text-[var(--gr-dead)]">
                    session not live — revoked or expired
                  </span>
                )}
                {live === "checking" && (
                  <span className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">checking KeyStore…</span>
                )}
              </div>
              <input value={sessionKeyId} onChange={(e) => setSessionKeyId(e.target.value)} placeholder={live ? "0x79f4…" : "keccak256 of your session public key (bytes32)"} className={`${field} font-mono`} />
            </label>

            {/* Cap */}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--gr-ink-2)]">Spend cap (BNB)</span>
              <input value={capLimit} onChange={(e) => setCapLimit(e.target.value)} type="number" step="0.001" min="0" className={field} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-[var(--gr-ink-2)]">Cap period</span>
              <select value={period.toString()} onChange={(e) => setPeriod(BigInt(e.target.value))} className={field}>
                {PERIODS.map((p) => (
                  <option key={p.value.toString()} value={p.value.toString()}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Allowlist */}
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-[var(--gr-ink-2)]">
                Allowlist (contracts the agent may call) — one per line, min 1
              </span>
              <textarea value={allowlist} onChange={(e) => setAllowlist(e.target.value)} rows={2} placeholder={"0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3\n0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"} className={`${field} font-mono`} />
              {allowlistArr.length > 0 && (
                <span className="mt-1 font-mono text-[0.6875rem] text-[var(--gr-live)]">
                  {allowlistArr.length} valid address(es) parsed
                </span>
              )}
            </label>
          </div>

          <button
            onClick={list}
            disabled={busy}
            className="mt-8 w-full rounded-xl bg-[var(--gr-magenta)] px-6 py-3.5 font-display text-sm font-semibold text-white shadow-[0_8px_30px_rgba(194,37,92,0.35)] transition hover:bg-[var(--gr-magenta-deep)] disabled:opacity-50"
          >
            {busy ? "Signing…" : needWallet && !isConnected ? "Connect wallet to list" : "List onchain · scope enforced"}
          </button>

          {result && (
            <div className="mt-4 rounded-xl border border-[var(--gr-border)] bg-[var(--gr-bg)] p-4 text-sm">
              {result.hash ? (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 h-2 w-2 rounded-full bg-[var(--gr-live)]" />
                  <div>
                    <p className="font-medium text-[var(--gr-live)]">Listing submitted onchain from your wallet.</p>
                    <p className="mt-1 font-mono text-xs text-[var(--gr-ink-2)]">
                      Your address ({address?.slice(0, 6)}…{address?.slice(-4)}) is the operator. New listings appear on the agents page once mined.
                    </p>
                    <a href={EXPLORER + result.hash} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-xs text-[var(--gr-magenta)] underline">
                      {EXPLORER + result.hash}
                    </a>
                  </div>
                </div>
              ) : (
                <p className="text-[var(--gr-dead)]">{result.error}</p>
              )}
            </div>
          )}

          <p className="mt-4 text-xs leading-relaxed text-[var(--gr-ink-3)]">
            The session key must be <em>live</em> in the Altana KeyStore at submit time — listing reverts otherwise
            (SessionNotLive). Revoked or expired sessions can never be listed, exactly as buyers would expect.
          </p>
        </div>
      </div>

      <footer className="border-t border-[var(--gr-border)] bg-[var(--gr-surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="flex items-center gap-2">
            <Logomark className="h-7 w-7" />
            <span className="font-display text-sm font-bold text-[var(--gr-ink)]">GuardRail</span>
          </div>
          <Link href="/agents" className="gr-link font-mono text-xs text-[var(--gr-ink-3)] transition hover:text-[var(--gr-magenta)]">
            Live agents →
          </Link>
        </div>
      </footer>
    </main>
  );
}

function parseCap(v: string): bigint {
  const w = BigInt(Math.round(parseFloat(v) * 1e18));
  return w > 0n ? w : 0n;
}