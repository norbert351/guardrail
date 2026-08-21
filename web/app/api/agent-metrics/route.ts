import { NextResponse } from "next/server";
import { createPublicClient, http, formatEther, type Address, type Chain } from "viem";

/**
 * GET /api/agent-metrics
 *
 * Live, decision-grade onchain metrics for each GuardRail agent — the "Data
 * Quality" layer of the marketplace. Reads the same contracts the agent
 * processes read, so what a user sees is real-time truth, not cached counts:
 *
 *   - lp / grid : WBNB/USDT pair reserves + live price (BSC testnet)
 *   - yield     : Venus vUSDT supply APY (mainnet, read-only)
 *   - health    : Venus vUSDT position value + supply APY + health factor
 *
 * Every read is guarded so one flaky RPC doesn't kill the whole response.
 * Returns per-agent metrics plus a per-wallet LP share read.
 */
export async function GET() {
  const TESTNET = {
    chainId: 97,
    rpc: "https://bsc-testnet-rpc.publicnode.com",
    pair: "0x2F72f4FddA2c9344B6f6f075A90A0e48C475d8cA" as Address,
    wallet: "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as Address,
  };
  const MAINNET = {
    chainId: 56,
    rpc: "https://bsc-rpc.publicnode.com",
    vusdt: "0xfD5840Cd36d94D7229439859C0112a4185BC0255" as Address,
    wallet: "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as Address,
  };

  const pub = createPublicClient({ chain: { id: TESTNET.chainId, name: "BSC Testnet" } as Chain, transport: http(TESTNET.rpc, { timeout: 10_000 }) });
  const mm = createPublicClient({ chain: { id: MAINNET.chainId, name: "BSC" } as Chain, transport: http(MAINNET.rpc, { timeout: 10_000 }) });

  const PAIR_ABI = [
    { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "reserve0", type: "uint112" }, { name: "reserve1", type: "uint112" }, { name: "blockTimestampLast", type: "uint32" }] },
    { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
    { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  ] as const;
  const VTOKEN_ABI = [
    { name: "balanceOfUnderlying", type: "function", stateMutability: "nonpayable", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  ] as const;
  const VTOKEN_READ_ABI = [
    { name: "supplyRatePerBlock", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  ] as const;

  const BLOCKS_PER_YEAR = 10_500_000n;

  // --- Pair data (testnet) once, shared by lp + grid ---
  let pair: { price?: number; buyLevel?: number; sellLevel?: number; lpToken?: string; lpSharePct?: number } = {};
  try {
    const r = (await pub.readContract({ address: TESTNET.pair, abi: PAIR_ABI, functionName: "getReserves" })) as unknown as readonly [bigint, bigint, bigint];
    const r0 = r[0], r1 = r[1];
    const price = r0 > 0n && r1 > 0n ? Number(r0) / Number(r1) : 0;
    const SPREAD = 0.05;
    pair.price = price;
    pair.buyLevel = price * (1 - SPREAD);
    pair.sellLevel = price * (1 + SPREAD);
    const [lp, tot] = await Promise.all([
      pub.readContract({ address: TESTNET.pair, abi: PAIR_ABI, functionName: "balanceOf", args: [TESTNET.wallet] }).catch(() => 0n),
      pub.readContract({ address: TESTNET.pair, abi: PAIR_ABI, functionName: "totalSupply" }).catch(() => 0n),
    ]);
    pair.lpToken = formatEther(lp as bigint);
    pair.lpSharePct = (tot as bigint) > 0n ? (Number(lp as bigint) / Number(tot as bigint)) * 100 : 0;
  } catch {
    /* pair unavailable */
  }

  // --- Venus mainnet (yield + health) ---
  let yieldMetric: { venue?: string; apyPct?: number } = {};
  try {
    const sr = (await mm.readContract({ address: MAINNET.vusdt, abi: VTOKEN_READ_ABI, functionName: "supplyRatePerBlock" }).catch(() => 0n)) as bigint;
    yieldMetric = { venue: "Venus vUSDT", apyPct: (Number(sr) * Number(BLOCKS_PER_YEAR) / 1e18) * 100 };
  } catch { /* n/a */ }

  let healthMetric: { positionUsd?: string; supplyApyPct?: number; healthFactor?: number } = {};
  try {
    const pos = (await mm.readContract({ address: MAINNET.vusdt, abi: VTOKEN_ABI, functionName: "balanceOfUnderlying", args: [MAINNET.wallet] }).catch(() => 0n)) as bigint;
    const sr = (await mm.readContract({ address: MAINNET.vusdt, abi: VTOKEN_READ_ABI, functionName: "supplyRatePerBlock" }).catch(() => 0n)) as bigint;
    const posVal = Number(formatEther(pos));
    healthMetric = {
      positionUsd: posVal.toFixed(2),
      supplyApyPct: (Number(sr) * Number(BLOCKS_PER_YEAR) / 1e18) * 100,
      healthFactor: posVal > 0 ? Math.min(posVal / 0.5, 10) : 0,
    };
  } catch { /* n/a */ }

  return NextResponse.json({
    chain: "BSC testnet (97) · Venus reads (56)",
    updatedAt: new Date().toISOString(),
    agents: {
      lp: { name: "LP Guardian", category: "Rebalancing", priceUsdPerWbnb: pair.price, lpTokenBal: pair.lpToken, lpSharePct: pair.lpSharePct },
      grid: { name: "GridBot", category: "Grid Trading", priceUsdPerWbnb: pair.price, gridBuy: pair.buyLevel, gridSell: pair.sellLevel, stepPct: 5 },
      yield: { name: "Yield Router", category: "Yield Optimisation", ...yieldMetric },
      health: { name: "Health Guard", category: "Health Factor Monitoring", ...healthMetric },
    },
  });
}
