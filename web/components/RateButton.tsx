"use client";

import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { MARKETPLACE } from "@/lib/guardrail";

type RateResult = { hash?: string; error?: string };

const RATE_ABI = [
  {
    name: "rate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "score", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

const EXPLORER = "https://bscscan.com/tx/";

/**
 * Rate this agent 1–5. Signs + broadcasts marketplace.rate(id, score) from the
 * connected wallet; recordHire/rate are public, so anyone can rate. The onchain
 * avg drives trustScore's review-sentiment component (max 30/100).
 */
export function RateButton({ listingId, agentName }: { listingId: number; agentName: string }) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RateResult>({});

  async function rate() {
    if (!score || score < 1 || score > 5) {
      setResult({ error: "Pick 1–5 stars before rating." });
      return;
    }
    if (!walletClient) {
      setResult({ error: "Connect wallet to rate." });
      return;
    }
    setBusy(true);
    setResult({});
    try {
      const hash = await walletClient.writeContract({
        address: MARKETPLACE,
        abi: RATE_ABI,
        functionName: "rate",
        args: [BigInt(listingId), score],
      });
      setResult({ hash });
    } catch (e) {
      setResult({ error: (e as { shortMessage?: string })?.shortMessage ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--gr-border)] bg-[var(--gr-bg)] p-2.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[0.6875rem] uppercase tracking-wide text-[var(--gr-ink-3)]">Rate {agentName}</span>
        <span className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">{score ? `${score}/5` : "—"}</span>
      </div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => setScore(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className={`h-8 w-8 rounded-md text-base transition ${score >= n ? "bg-[var(--gr-magenta)] text-white" : "bg-[var(--gr-mono-chip)] text-[var(--gr-ink-3)] hover:bg-[var(--gr-mono-chip)]"}`}
          >
            ★
          </button>
        ))}
        <button
          onClick={rate}
          disabled={busy}
          className="ml-auto rounded-md px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50"
          style={{ background: "var(--gr-magenta)" }}
        >
          {busy ? "Signing…" : "Rate"}
        </button>
      </div>
      {!isConnected && <p className="mt-1.5 font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">Connect wallet to rate this agent.</p>}
      {result.hash && (
        <p className="mt-1.5 font-mono text-[0.6875rem] break-all text-[var(--gr-live)]">
          Rated {score}/5 ·{" "}
          <a href={`${EXPLORER}${result.hash}`} target="_blank" rel="noreferrer" className="underline">
            {result.hash.slice(0, 12)}…
          </a>
        </p>
      )}
      {result.error && <p className="mt-1.5 font-mono text-[0.6875rem] break-words text-[var(--gr-dead)]">{result.error}</p>}
    </div>
  );
}