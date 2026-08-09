/**
 * GuardRail Yield Router (category 2: Yield Optimisation).
 *
 * Routes liquidity to the highest available APR:
 *   - reads live supply APRs from real BNB Chain yield markets (Venus
 *     vUSDT mainnet RPC, read-only and free),
 *   - compares against the native benchmark (BNB staking ~ implied by
 *     WBNB wrap, for demo purposes a constant floor),
 *   - if the best market beats the current allocation by a margin, it
 *     executes a routing step within its scoped session (wrap BNB -> WBNB
 *     as the demo allocation action; its allowlist only permits the router
 *     and WBNB calls),
 *   - otherwise it reports the best market and holds position.
 *
 * The decision rule is transparent: pick max(APR) above the floor and a
 * rebalance margin. Session key is the agent identity on the KeyStore,
 * bound to GuardRailMarketplace listing #8, capped at 0.02 tBNB/day.
 *
 * Usage: tsx src/agents/yield-router.ts [--once] [--loop-seconds 60]
 */

import { parseEther } from "viem";
import { act, loadAgent, log, VENUS_VUSDT_MAINNET } from "./lib.js";

const VTOKEN_ABI = [
  { name: "supplyRatePerBlock", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "exchangeRateStored", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const BLOCKS_PER_YEAR = 10_500_000n;
// Demo floor: what the wallet gets just holding. If no market beats this by
// the margin, the agent holds.
const FLOOR_APR = 3.0;
const MARGIN = 1.0; // rebalance only if best APR beats floor by this much

async function checkOnce() {
  const agent = await loadAgent(2);
  log(agent.config.name, `listing #${agent.config.listingId}, session key is the onchain identity`);

  // Real APR reads against Venus mainnet.
  const venusRate = (await agent.mainnetPubClient.readContract({
    address: VENUS_VUSDT_MAINNET,
    abi: VTOKEN_ABI,
    functionName: "supplyRatePerBlock",
  }).catch(() => 0n)) as bigint;
  const venusApy = Number(venusRate) * Number(BLOCKS_PER_YEAR) / 1e18 * 100;

  const markets = [
    { name: "Venus vUSDT", apy: venusApy },
    { name: "Native hold (floor)", apy: FLOOR_APR },
  ];
  const best = markets.reduce((a, b) => (b.apy > a.apy ? b : a));
  log(agent.config.name, `APRs: ${markets.map((m) => `${m.name} ${m.apy.toFixed(2)}%`).join(", ")}`);
  log(agent.config.name, `best market: ${best.name} at ${best.apy.toFixed(2)}%`);

  if (process.argv.includes("--act")) {
    log(agent.config.name, "demo act: allocate 0.001 BNB -> WBNB via session key");
    const result = await act(agent, [
      { to: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", data: "0xd0e30db0", value: parseEther("0.001") },
    ]);
    log(agent.config.name, result.ok ? `session tx sent ${result.tx}` : `blocked by session: ${result.error}`);
    return;
  }

  if (best.apy > FLOOR_APR + MARGIN) {
    log(agent.config.name, `routing: ${best.name} beats floor by ${(best.apy - FLOOR_APR).toFixed(2)}pp, allocating 0.001 BNB`);
    const result = await act(agent, [
      // WBNB.deposit() with 0.001 BNB: the allocation action within scope.
      { to: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", data: "0xd0e30db0", value: parseEther("0.001") },
    ]);
    log(agent.config.name, result.ok ? `allocation sent ${result.tx}` : `allocation blocked by session: ${result.error}`);
  } else {
    log(agent.config.name, `no market beats floor by ${MARGIN}pp, holding position`);
  }
}

const once = process.argv.includes("--once");
const loopArg = process.argv.find((a) => a.startsWith("--loop-seconds"));
const loopSeconds = loopArg ? Number(loopArg.split("=")[1] ?? 60) : 60;

if (once) {
  checkOnce().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  log("Yield Router", `routing loop every ${loopSeconds}s (Ctrl-C to stop)`);
  const tick = async () => {
    try {
      await checkOnce();
    } catch (e) {
      log("Yield Router", `cycle error: ${String(e).slice(0, 200)}`);
    }
  };
  await tick();
  setInterval(tick, loopSeconds * 1000);
}
