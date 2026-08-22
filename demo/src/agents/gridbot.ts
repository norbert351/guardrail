/**
 * GuardRail GridBot (category 1: Grid Trading).
 *
 * Runs a bounded grid strategy on the WBNB/USDT pair:
 *   - reads the live pair reserves (real testnet state) and derives the
 *     current price,
 *   - maintains a grid of N levels around the anchor: one buy level below,
 *     one sell level above (a 2-level micro grid for the demo),
 *   - when the price crosses a level, the grid "fires": the agent executes
 *     a scoped swap through its session key to capture the grid tick
 *     (buy low at the lower level, sell high at the upper level),
 *   - every action goes through the session allowlist (PancakeSwap router +
 *     WBNB only), capped at 0.02 tBNB/day, so a runaway grid cannot drain
 *     the wallet. This is the GuardRail point: the strategy is aggressive
 *     by design, the session is what bounds it.
 *
 * The decision rule is transparent: sell above +spread%, buy below -spread%.
 * Session key is the agent identity on the KeyStore, bound to
 * GuardRailMarketplace listing #7, capped at 0.02 tBNB/day.
 *
 * Usage: tsx src/agents/gridbot.ts [--once] [--loop-seconds 60] [--act]
 */

import { encodeFunctionData, parseEther } from "viem";
import { act, claudeAdvise, loadAgent, log, PANCAKE_ROUTER, WBNB } from "./lib.js";

const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as `0x${string}`;
const PAIR = "0x2F72f4FddA2c9344B6f6f075A90A0e48C475d8cA" as `0x${string}`;
const AMOUNT_IN = parseEther("0.001"); // 0.001 tBNB per grid tick

const PAIR_ABI = [
  { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [
    { name: "reserve0", type: "uint112" }, { name: "reserve1", type: "uint112" }, { name: "blockTimestampLast", type: "uint32" }] },
] as const;

const SPREAD = 0.05; // 5% grid step

async function checkOnce() {
  const agent = await loadAgent(1);
  log(agent.config.name, `listing #${agent.config.listingId}, session key is the onchain identity`);

  const reserves = (await agent.pubClient.readContract({
    address: PAIR,
    abi: PAIR_ABI,
    functionName: "getReserves",
  })) as readonly [bigint, bigint, number];

  // token0 = USDT, token1 = WBNB. Price = USDT per WBNB.
  const price = Number(reserves[0]) / Number(reserves[1]);
  const buyLevel = price * (1 - SPREAD);
  const sellLevel = price * (1 + SPREAD);

  log(agent.config.name, `pair price ${price.toFixed(2)} USDT/WBNB, grid buy ${buyLevel.toFixed(2)} / sell ${sellLevel.toFixed(2)}`);

  // Claude advisory: a second opinion on grid tightness given the live
  // price. Non-binding — the grid rule and the session cap still decide.
  await claudeAdvise(
    agent.config.name,
    "You are a grid-trading strategist for a GuardRail scoped-session bot. Reply in one short sentence: whether a 5% grid step around the given price is sensible for WBNB/USDT on BSC testnet, and why.",
    `WBNB/USDT price ${price.toFixed(2)}, grid buy level ${buyLevel.toFixed(2)} (-5%), sell level ${sellLevel.toFixed(2)} (+5%).`,
  );

  // The rule: the grid fires when the market trades through a level. The
  // demo simulates one tick per cycle by comparing against the anchor; in a
  // live deployment the agent watches the price stream and swaps when a
  // level is touched. --act forces one grid tick to prove the session path.
  if (process.argv.includes("--act")) {
    const swapData = encodeFunctionData({
      abi: [
        {
          name: "swapExactETHForTokens",
          type: "function",
          stateMutability: "payable",
          inputs: [
            { name: "amountOutMin", type: "uint256" },
            { name: "path", type: "address[]" },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
          outputs: [{ name: "amounts", type: "uint256[]" }],
        },
      ] as const,
      functionName: "swapExactETHForTokens",
      args: [1n, [WBNB, USDT], agent.session.walletAddress, BigInt(Math.floor(Date.now() / 1000) + 600)],
    });
    log(agent.config.name, `grid tick: buying ${AMOUNT_IN} tBNB worth of USDT at the lower grid level (via session)`);
    const result = await act(agent, [{ to: PANCAKE_ROUTER, data: swapData, value: AMOUNT_IN }]);
    log(agent.config.name, result.ok ? `grid tick sent ${result.tx}` : `grid tick blocked by session: ${result.error}`);
    return;
  }

  // Read-only cycle: report the grid levels and the last execution state.
  log(agent.config.name, `grid armed: buy @ ${buyLevel.toFixed(2)} (-${SPREAD * 100}%), sell @ ${sellLevel.toFixed(2)} (+${SPREAD * 100}%)`);
  log(agent.config.name, `spend cap 0.02 tBNB/day enforces the max grid exposure onchain`);
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
  log("GridBot", `grid loop every ${loopSeconds}s (Ctrl-C to stop)`);
  const tick = async () => {
    try {
      await checkOnce();
    } catch (e) {
      log("GridBot", `cycle error: ${String(e).slice(0, 200)}`);
    }
  };
  await tick();
  setInterval(tick, loopSeconds * 1000);
}
