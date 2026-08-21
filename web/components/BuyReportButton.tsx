"use client";

import { useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { keccak256, type Address, type Hex } from "viem";

type BuyResult = {
  ok: boolean;
  receipt?: { payer?: string; amount?: string; token?: string; rail?: string };
  report?: string;
  error?: string;
};

type Challenge = {
  x402Version?: number;
  resource?: unknown;
  accepts?: Array<{
    scheme?: string;
    network?: string;
    asset?: string;
    payTo?: string;
    amount?: string;
    maxTimeoutSeconds?: number;
    extra?: { name?: string; version?: string; assetTransferMethod?: string };
  }>;
};

export function BuyReportButton({ kind, agentName }: { kind: "health" | "yield" | "lp" | "grid"; agentName: string }) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BuyResult | null>(null);
  const [needWallet, setNeedWallet] = useState(false);

  async function buy() {
    setBusy(true);
    setResult(null);
    setNeedWallet(false);
    try {
      if (!isConnected || !address) {
        setNeedWallet(true);
        setResult({ ok: false, error: "Connect your wallet to pay 0.1 $U for this report (anti-bot gate)." });
        return;
      }

      // 1. Fetch the 402 challenge (price quote).
      const cRes = await fetch(`/api/x402/${kind}`);
      const challenge = (await cRes.json()) as Challenge;
      const req = challenge.accepts?.find((a) => a.extra?.assetTransferMethod === "eip3009");
      if (!req || !req.asset || !req.payTo || !req.amount) {
        setResult({ ok: false, error: "merchant offers no eip3009 rail" });
        return;
      }

      // 2. Build + sign EIP-3009 TransferWithAuthorization with the connected wallet.
      const now = Math.floor(Date.now() / 1000);
      const nonce = keccak256(`0x${Math.random().toString(16).slice(2).padStart(64, "0")}` as Hex);
      const message = {
        from: address,
        to: req.payTo as Address,
        value: BigInt(req.amount),
        validAfter: 0n,
        validBefore: BigInt(now + 300),
        nonce,
      };
      const signature = await signTypedDataAsync({
        domain: { name: req.extra?.name ?? "United Stables", version: req.extra?.version ?? "1", chainId: 97, verifyingContract: req.asset as Address },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: message as any,
      });

      // 3. Envelope matching the merchant decoder, signed by the USER wallet.
      const envelope = {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:97",
        resource: challenge.resource,
        accepted: req,
        payload: {
          signature,
          authorization: {
            from: address,
            to: req.payTo,
            value: req.amount,
            validAfter: "0",
            validBefore: String(now + 300),
            nonce,
          },
        },
      };

      // 4. Submit via the merchant proxy (paid GET with X-PAYMENT header).
      const header = Buffer.from(JSON.stringify(envelope)).toString("base64");
      const r = await fetch(`/api/x402/${kind}`, {
        headers: { "X-PAYMENT": header, "PAYMENT-SIGNATURE": header, "content-type": "application/json" },
      });
      const data = await r.json();
      if (r.status === 200) {
        setResult({
          ok: true,
          receipt: data.paid,
          report: String(data.report ?? ""),
        });
      } else {
        setResult({ ok: false, error: String(data.error ?? data.message ?? "payment rejected") });
      }
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      setResult({ ok: false, error: err.shortMessage ?? err.message ?? String(e) });
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
        {busy ? "Signing + paying…" : needWallet && !isConnected ? "Connect wallet to buy" : "Buy report · 0.1 $U"}
      </button>
      {result && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs">
          {result.ok ? (
            <>
              <p className="font-medium text-emerald-700">Paid via x402 (your wallet, $U)</p>
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
      <p className="text-[10px] text-zinc-400">{agentName} report · 0.1 $U from your wallet · settled onchain on BSC testnet</p>
    </div>
  );
}
