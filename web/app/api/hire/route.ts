import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, type Address, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";

/**
 * POST /api/hire
 * Body: { provider: string, task?: string, budget?: number }
 *
 * Honest change on the GuardRail marketplace's own contract: on BSC testnet
 * records the hire onchain by calling the marketplace's recordHire(listingId)
 * — a real transaction that increments the agent's hire counter in the
 * explorer. This is NOT the ERC-8183 escrow: that rail is externally blocked
 * on testnet (the EvaluatorRouter's OptimisticPolicy whitelist was wiped by an
 * Altana upgrade; registerJob reverts with PolicyNotWhitelisted, only the
 * router owner can restore it). The UI surfaces the truth about the escrow
 * instead of faking it, and the full escrow flow is proven on mainnet.
 *
 * Returns { ok, tx?, listingId?, hires?, escrow?, error? }.
 */
function adminKeyOf(): Hex {
  if (process.env.GUARDRAIL_ADMIN_KEY) return process.env.GUARDRAIL_ADMIN_KEY as Hex;
  // Local/VM fallback: read from the gitignored demo state file (matches the
  // other routes' behavior on this box).
  const f = process.env.GUARDRAIL_DEMO_DIR
    ? `${process.env.GUARDRAIL_DEMO_DIR.replace(/\/$/, "")}/.guardrail-state.json`
    : "/home/ubuntu/guardrail/demo/.guardrail-state.json";
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).adminKey as Hex;
  throw new Error("no admin key (set GUARDRAIL_ADMIN_KEY)");
}
export async function POST(req: Request) {
  let body: { provider?: string; listingId?: number; task?: string; budget?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider;
  if (!provider || !/^0x[a-fA-F0-9]{40}$/.test(provider)) {
    return NextResponse.json({ ok: false, error: "provider must be a 0x address" }, { status: 400 });
  }
  // The card already knows its listing id — prefer it over wallet lookup so
  // two agents sharing one wallet still record to the right listing.
  const requestedListing = body.listingId && Number.isInteger(body.listingId) ? body.listingId : undefined;

  const TESTNET = {
    chainId: 97,
    rpc: "https://bsc-testnet-rpc.publicnode.com",
    marketplace: "0x57039e8fea975C7C819Fe03b50c733d38f38387D" as Address,
    router: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25" as Address,
    policy: "0x4F4678D4439feC812Ac7674Bb3Efb4C8f5Fb78A6" as Address,
  };

  const chain = { id: TESTNET.chainId, name: "BSC Testnet" } as Chain;
  const pubClient = createPublicClient({ chain, transport: http(TESTNET.rpc, { timeout: 15_000 }) });

  // Signer: the GuardRail admin wallet (same wallet that owns the listings).
  const account = privateKeyToAccount(adminKeyOf());
  const adminAddress = account.address as Address;

  try {
    // Read listing count, then find the listing whose agentWallet == provider.
    const MARKETPLACE_ABI = [
      { name: "listingCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
      { name: "listingSummary", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ name: "_id", type: "uint256" }, { name: "category", type: "uint8" }, { name: "name", type: "string" }, { name: "agentWallet", type: "address" }, { name: "sessionKeyId", type: "bytes32" }, { name: "operator", type: "address" }, { name: "listedAt", type: "uint256" }] },
      { name: "recordHire", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
      { name: "stats", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ name: "hires", type: "uint32" }, { name: "ratingSum", type: "uint256" }, { name: "ratingCount", type: "uint32" }] },
    ] as const;

    const count = Number(await pubClient.readContract({ address: TESTNET.marketplace, abi: MARKETPLACE_ABI, functionName: "listingCount" }));
    let listingId: number | null = null;
    if (requestedListing !== undefined) {
      // Validate the requested listing exists and is owned by the provider.
      const s = await pubClient
        .readContract({ address: TESTNET.marketplace, abi: MARKETPLACE_ABI, functionName: "listingSummary", args: [BigInt(requestedListing)] })
        .catch(() => null);
      if (s && String(s[3]).toLowerCase() === provider.toLowerCase()) listingId = requestedListing;
    }
    if (listingId === null) {
      for (let i = 1; i <= count; i++) {
        const s = await pubClient
          .readContract({ address: TESTNET.marketplace, abi: MARKETPLACE_ABI, functionName: "listingSummary", args: [BigInt(i)] })
          .catch(() => null);
        if (s && String(s[3]).toLowerCase() === provider.toLowerCase()) {
          listingId = i;
          break;
        }
      }
    }
    if (listingId === null) {
      return NextResponse.json({ ok: false, error: "no listing found for provider wallet" }, { status: 404 });
    }

    // Broadcast recordHire(listingId) from the admin wallet (pays testnet gas).
    const walletClient = createWalletClient({ account, chain, transport: http(TESTNET.rpc, { timeout: 15_000 }) });
    const tx = await walletClient.writeContract({
      address: TESTNET.marketplace,
      abi: MARKETPLACE_ABI,
      functionName: "recordHire",
      args: [BigInt(listingId)],
    });
    await pubClient.waitForTransactionReceipt({ hash: tx, timeout: 30_000 });

    // Read post-state: hire count for this listing.
    let hires: number | null = null;
    try {
      const st = (await pubClient.readContract({ address: TESTNET.marketplace, abi: MARKETPLACE_ABI, functionName: "stats", args: [BigInt(listingId)] })) as readonly [number, bigint, number];
      hires = Number(st[0]);
    } catch { /* ignore */ }

    // Honest escrow status read (vital: canHire=false on testnet).
    let canEscrow: boolean | undefined;
    try {
      canEscrow = (await pubClient.readContract({
        address: TESTNET.router,
        abi: [{ name: "policyWhitelist", type: "function", stateMutability: "view", inputs: [{ name: "policy", type: "address" }], outputs: [{ type: "bool" }] }],
        functionName: "policyWhitelist",
        args: [TESTNET.policy],
      })) as boolean;
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      tx,
      listingId,
      hires,
      escrow: {
        canEscrow: canEscrow === true,
        note: canEscrow === true
          ? "ERC-8183 escrow is live on this chain."
          : "Testnet escrow is externally blocked (Altana router policy whitelist was wiped — registerJob reverts with PolicyNotWhitelisted). Hire was recorded onchain; full escrow is proven on mainnet.",
      },
    });
  } catch (e) {
    const err = e as { shortMessage?: string; message?: string };
    return NextResponse.json({ ok: false, error: err.shortMessage ?? err.message ?? String(e) });
  }
}
