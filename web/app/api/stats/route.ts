import { NextResponse } from "next/server";
import { createPublicClient, http, formatEther, type Address } from "viem";
import { bsc } from "viem/chains";
import { MARKETPLACE, ALTANA_KEYSTORE } from "@/lib/guardrail";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats — per-listing onchain stats (hires / ratings) + the agent
 * wallet's settled $U balance. Reads the v2 MAINNET marketplace + mainnet $U.
 * Real chain truth: hires and ratingCount drive trustScore off its base 40.
 */

const U_TOKEN = "0xcE24439F2D9C6a2289F741120FE202248B666666" as Address;
const WALLET = "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as Address;

const ABI = [
  {
    name: "stats",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "hires", type: "uint32" },
      { name: "ratingSum", type: "uint256" },
      { name: "ratingCount", type: "uint32" },
    ],
  },
] as const;
const ERC20 = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export async function GET() {
  const rpc = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";
  const client = createPublicClient({ chain: bsc, transport: http(rpc, { timeout: 15_000 }) });

  try {
    const updates = await Promise.all(
      [1, 2, 3, 4].map(async (id) => {
        const s = await client.readContract({ address: MARKETPLACE, abi: ABI, functionName: "stats", args: [BigInt(id)] }).catch(() => [0n, 0n, 0n] as const);
        const [hires, ratingSum, ratingCount] = s as unknown as readonly [bigint, bigint, bigint];
        const avg = ratingCount > 0n ? Number(ratingSum) / Number(ratingCount) : 0;
        return { id, hires: Number(hires), ratingCount: Number(ratingCount), avgRating: avg };
      })
    );

    const uBal = await client.readContract({ address: U_TOKEN, abi: ERC20, functionName: "balanceOf", args: [WALLET] }).catch(() => 0n);

    return NextResponse.json({
      marketplace: MARKETPLACE,
      keyStore: ALTANA_KEYSTORE,
      chainId: 56,
      agentWallet: WALLET,
      settledU: formatEther(uBal as bigint),
      listings: updates,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}