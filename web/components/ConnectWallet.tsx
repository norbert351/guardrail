"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full bg-[var(--gr-live-soft)] px-2.5 py-1 font-mono text-[0.6875rem] font-medium text-[var(--gr-live)] sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gr-live)]" />
          connected
        </span>
        <button
          onClick={() => disconnect()}
          className="rounded-xl border border-[var(--gr-border)] bg-[var(--gr-surface)] px-4 py-2 font-mono text-xs font-medium text-[var(--gr-ink)] transition hover:bg-[var(--gr-surface-2)]"
          title={address}
        >
          {address.slice(0, 6)}…{address.slice(-4)}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: connectors[0] })}
      disabled={isPending}
      className="rounded-xl bg-[var(--gr-ink)] px-4 py-2 font-display text-xs font-semibold text-white transition hover:bg-[var(--gr-magenta)] disabled:opacity-50"
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
