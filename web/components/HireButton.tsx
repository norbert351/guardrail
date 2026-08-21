"use client";

import { useEffect, useState } from "react";

type HireStatus = {
  chain: string;
  policyWhitelisted: boolean | undefined;
  buyerUSBalance: string | undefined;
  jobCounter: string | undefined;
  canHire: boolean;
  note: string;
};

type HireResult = {
  ok: boolean;
  tx?: string;
  listingId?: number;
  hires?: number | null;
  escrow?: { canEscrow?: boolean; note?: string };
  error?: string;
};

const EXPLORER = "https://testnet.bscscan.com/tx/";

export function HireButton({ provider, agentName, listingId }: { provider: string; agentName: string; listingId: number }) {
  const [status, setStatus] = useState<HireStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HireResult | null>(null);

  useEffect(() => {
    fetch("/api/hire/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function hire() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/hire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          listingId,
          task: `Hire ${agentName} for a scoped onchain task.`,
          budget: 0.1,
        }),
      });
      setResult(await r.json());
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={hire}
        disabled={busy}
        className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {busy ? "Hiring…" : "Hire"}
      </button>

      {status && !status.canHire && (
        <p className="text-xs text-amber-700" title={status.note}>
          ⚠ testnet hire rail blocked (policy whitelist empty)
        </p>
      )}
      {status?.canHire && status.buyerUSBalance !== undefined && (
        <p className="text-xs text-zinc-400">buyer $U: {status.buyerUSBalance}</p>
      )}

      {result && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs">
          {result.ok ? (
            <>
              <p className="font-medium text-emerald-700">
                Hire recorded onchain · listing #{result.listingId}
                {result.hires !== undefined && result.hires !== null ? ` (${result.hires} hire${result.hires === 1 ? "" : "s"})` : ""}
              </p>
              {result.tx && (
                <a href={EXPLORER + result.tx} target="_blank" rel="noreferrer" className="block font-mono text-zinc-500 underline">
                  {result.tx.slice(0, 18)}…
                </a>
              )}
              {result.escrow && !result.escrow.canEscrow && (
                <p className="mt-1 text-amber-700">{result.escrow.note}</p>
              )}
            </>
          ) : (
            <p className="text-red-600 break-words">{result.error ?? "hire failed"}</p>
          )}
        </div>
      )}
    </div>
  );
}
