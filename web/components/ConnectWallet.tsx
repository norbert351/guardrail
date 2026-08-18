"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

// Wallets we support natively via injected EIP-1193 providers — no
// WalletConnect projectId required. Each maps to an injected connector that
// targets that wallet's provider by its feature flag. Detection reads the
// installed providers (window.ethereum + EIP-6963 announcements), so only
// wallets actually installed in the browser are shown.
const WALLETS = [
  {
    id: "metaMask",
    name: "MetaMask",
    accent: "#f6851b",
    letter: "🦊",
    flag: (p: any) => !!p.isMetaMask && !p.isRabby,
  },
  {
    id: "rabby",
    name: "Rabby",
    accent: "#8697ff",
    letter: "🐾",
    flag: (p: any) => !!p.isRabby,
  },
  {
    id: "okxWallet",
    name: "OKX Wallet",
    accent: "#3b82f6",
    letter: "⭕",
    flag: (p: any) => !!p.isOkxWallet || !!p.isOKExWallet,
  },
  {
    id: "trust",
    name: "Trust Wallet",
    accent: "#0500ff",
    letter: "🟦",
    flag: (p: any) => !!p.isTrust || !!p.isTrustWallet || !!p.isTokenPocket,
  },
];

type WalletMeta = (typeof WALLETS)[number];

function collectProviders(): any[] {
  const w = window as any;
  const eth = w.ethereum;
  if (!eth) return [];
  return Array.isArray(eth.providers) && eth.providers.length ? eth.providers : [eth];
}

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState<Set<string>>(new Set());

  // Detect installed wallets from providers (incl. async EIP-6963 announces).
  const refresh = useCallback(() => {
    const found = new Set<string>();
    for (const p of collectProviders()) {
      for (const w of WALLETS) if (w.flag(p)) found.add(w.id);
    }
    setInstalled(found);
  }, []);
  useEffect(() => {
    refresh();
    const onAnnounce = (e: Event) => {
      const { detail } = e as CustomEvent;
      for (const w of WALLETS) if (w.flag(detail?.provider)) setInstalled((s) => new Set(s).add(w.id));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, [refresh]);

  const byId = useMemo(() => {
    const map = new Map<string, (typeof connectors)[number]>();
    for (const c of connectors) {
      map.set(c.id, c);
      map.set(c.name.toLowerCase(), c);
    }
    return map;
  }, [connectors]);

  const connectWallet = useCallback(
    (w: WalletMeta) => {
      const conn = byId.get(w.id) ?? byId.get(w.name.toLowerCase()) ?? connectors.find((c) => c.id === "metaMask");
      if (conn) connect({ connector: conn });
      setOpen(false);
    },
    [byId, connectors, connect],
  );

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
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={isPending}
        className="rounded-xl bg-[var(--gr-ink)] px-4 py-2 font-display text-xs font-semibold text-white transition hover:bg-[var(--gr-magenta)] disabled:opacity-50"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-[var(--gr-border)] bg-[var(--gr-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-[var(--gr-ink)]">Connect a wallet</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 font-mono text-sm text-[var(--gr-ink-3)] hover:bg-[var(--gr-surface-2)]">
                ✕
              </button>
            </div>
            <p className="mb-4 text-sm text-[var(--gr-ink-2)]">
              Direct browser-extension connect — no WalletConnect needed. You&apos;ll see the wallets installed in this browser.
            </p>
            <div className="flex flex-col gap-2">
              {WALLETS.map((w) => {
                const present = installed.has(w.id);
                return (
                  <button
                    key={w.id}
                    disabled={!present || isPending}
                    onClick={() => connectWallet(w)}
                    className="flex items-center justify-between rounded-xl border border-[var(--gr-border)] bg-[var(--gr-bg)] px-4 py-3 text-left transition hover:border-[var(--gr-magenta)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-sm"
                        style={{ backgroundColor: w.accent + "22", color: w.accent }}
                      >
                        {w.letter}
                      </span>
                      <span className="font-display text-sm font-semibold text-[var(--gr-ink)]">{w.name}</span>
                    </span>
                    <span className="font-mono text-[0.6875rem] text-[var(--gr-ink-3)]">{present ? "detected" : "not installed"}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-[var(--gr-ink-3)]">
              Install Rabby, MetaMask, OKX, or Trust as a browser extension (or click MetaMask&apos;s browser button) to connect.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
