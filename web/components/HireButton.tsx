"use client";

import { useEffect, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";

type HireStatus = {
  chain: string;
  policyWhitelisted: boolean | undefined;
  buyerUSBalance: string | undefined;
  jobCounter: string | undefined;
  canHire: boolean;
  note: string;
};

type HireResult = {
  hash?: string;
  error?: string;
};

const EXPLORER = "https://testnet.bscscan.com/tx/";
const MARKETPLACE = "0x57039e8fea975C7C819Fe03b50c733d38f38387D" as `0x${string}`;
const MARKETPLACE_ABI = [
  { name: "recordHire", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
] as const;

export function HireButton({ provider, agentName, listingId }: { provider: string; agentName: string; listingId: number }) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [status, setStatus] = useState<HireStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HireResult | null>(null);
  const [needWallet, setNeedWallet] = useState(false);

  useEffect(() => {
    fetch("/api/hire/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function hire() {
    setBusy(true);
    setResult(null);
    setNeedWallet(false);
    try {
      if (!isConnected || !walletClient || !address) {
        setNeedWallet(true);
        setResult({ error: "Connect your wallet to hire this agent (anti-bot gate)." });
        return;
      }
      // The USER's wallet signs + submits recordHire — their address is
      // recorded as the hirer onchain, and they pay their own testnet gas.
      const hash = await walletClient.writeContract({
        address: MARKETPLACE,
        abi: MARKETPLACE_ABI,
        functionName: "recordHire",
        args: [BigInt(listingId)],
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
    <div className="flex flex-col gap-2">
      <button
        onClick={hire}
        disabled={busy}
        className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {busy ? "Signing…" : needWallet && !isConnected ? "Connect wallet to hire" : "Hire · your wallet signs"}
      </button>

      {result && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs">
          {result.hash ? (
            <>
              <p className="font-medium text-emerald-700">Hire recorded onchain from your wallet · listing #{listingId}</p>
              <a href={EXPLORER + result.hash} target="_blank" rel="noreferrer" className="block font-mono text-zinc-500 underline">
                {result.hash.slice(0, 18)}…
              </a>
              <p className="mt-1 text-zinc-500">Your address ({address?.slice(0, 6)}…{address?.slice(-4)}) is recorded as the hirer.</p>
            </>
          ) : (
            <p className="text-red-600 break-words">{result.error ?? "hire failed"}</p>
          )}
        </div>
      )}

      {status && !status.canHire && (
        <p className="text-xs text-amber-700" title={status.note}>
          ⚠ escrow settle blocked on testnet (external); hire recorded onchain
        </p>
      )}
    </div>
  );
}
