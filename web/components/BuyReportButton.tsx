"use client";

import { useState } from "react";

type BuyResult = {
  ok: boolean;
  receipt?: { payer?: string; amount?: string; token?: string; rail?: string };
  report?: string;
  error?: string;
};

export function BuyReportButton({ kind, agentName }: { kind: "health" | "yield" | "lp" | "grid"; agentName: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BuyResult | null>(null);

  async function buy() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/buy-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
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
        onClick={buy}
        disabled={busy}
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {busy ? "Buying report…" : "Buy report · 0.1 $U"}
      </button>
      {result && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs">
          {result.ok ? (
            <>
              <p className="font-medium text-emerald-700">Paid via x402 (EIP-3009, $U)</p>
              {result.receipt && (
                <p className="font-mono text-zinc-500 break-all">
                  {result.receipt.payer?.slice(0, 10)}… paid {Number(result.receipt.amount ?? 0) / 1e18} $U · {result.receipt.rail}
                </p>
              )}
              {result.report && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-zinc-600">
                  {result.report.slice(0, 600)}
                </pre>
              )}
            </>
          ) : (
            <p className="text-red-600 break-words">{result.error ?? "purchase failed"}</p>
          )}
        </div>
      )}
      <p className="text-[10px] text-zinc-400">{agentName} report, settled onchain on BSC testnet</p>
    </div>
  );
}
