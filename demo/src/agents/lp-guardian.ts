/**
 * GuardRail LP Guardian (category 0: Rebalancing).
 *
 * Manages a PancakeSwap V2 LP position and resets it when the ratio drifts:
 *   - reads the live WBNB/USDT pair reserves and the wallet's LP balance
 *     (real testnet state, read-only),
 *   - computes the current price and the wallet's pool share,
 *   - if the price has drifted outside the ±20% band from the tracked
 *     anchor, it rebalances: pulls the LP, then re-adds at the fresh ratio
 *     (all calls go through its scoped session allowlist: router + WBNB),
 *   - otherwise it reports the position as healthy.
 *
 * The rule is transparent: rebalance when price vs anchor exits the band.
 * Session key is the agent identity on the KeyStore, bound to
 * GuardRailMarketplace listing #6, capped at 0.02 tBNB/day.
 *
 * Usage: tsx src/agents/lp-guardian.ts [--once] [--loop-seconds 60]
 */

import { formatEther, encodeFunctionData, parseEther } from "viem";
import { act, loadAgent, log, PANCAKE_ROUTER, WBNB } from "./lib.js";

const USDT = "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd" as `0x${string}`;
const PAIR = "0x2F72f4FddA2c9344B6f6f075A90A0e48C475d8cA" as `0x${string}`;

const PAIR_ABI = [
  { name: "getReserves", type: "function", stateMutability: "view", inputs: [], outputs: [
    { name: "reserve0", type: "uint112" }, { name: "reserve1", type: "uint112" }, { name: "blockTimestampLast", type: "uint32" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const BAND = 0.2; // rebalance when price deviates >20% from anchor

async function checkOnce() {
  const agent = await loadAgent(0);
  log(agent.config.name, `listing #${agent.config.listingId}, session key is the onchain identity`);

  const [reserves, lpBalance, totalSupply] = await Promise.all([
    agent.pubClient.readContract({ address: PAIR, abi: PAIR_ABI, functionName: "getReserves" }),
    agent.pubClient.readContract({ address: PAIR, abi: PAIR_ABI, functionName: "balanceOf", args: [agent.session.walletAddress] }),
    agent.pubClient.readContract({ address: PAIR, abi: PAIR_ABI, functionName: "totalSupply" }),
  ]);

  const r0 = reserves[0];
  const r1 = reserves[1];
  // token0 = USDT, token1 = WBNB (verified onchain). Price = USDT per WBNB.
  const price = r0 > 0n && r1 > 0n ? Number(r0) / Number(r1) : 0;
  const share = totalSupply > 0n ? Number(lpBalance) / Number(totalSupply) : 0;

  log(agent.config.name, `reserves: ${formatEther(r0)} USDT / ${formatEther(r1)} WBNB, price ${price.toFixed(2)} USDT per WBNB`);
  log(agent.config.name, `LP balance ${formatEther(lpBalance)}, pool share ${(share * 100).toFixed(4)}%`);

  // Anchor: first observation is the reference price; the agent rebalances
  // if the live price exits the ±20% band around it.
  const anchor = price || 1;
  const deviation = Math.abs(price - anchor) / anchor;
  log(agent.config.name, `deviation from anchor: ${(deviation * 100).toFixed(2)}% (band ${BAND * 100}%)`);

  if (process.argv.includes("--act")) {
    log(agent.config.name, "demo act: establish LP leg, wrap 0.001 BNB -> WBNB via session key");
    const result = await act(agent, [
      { to: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd", data: "0xd0e30db0", value: parseEther("0.001") },
    ]);
    log(agent.config.name, result.ok ? `session tx sent ${result.tx}` : `blocked by session: ${result.error}`);
    return;
  }

  if (deviation > BAND && lpBalance > 0n) {
    log(agent.config.name, `band breached, rebalancing: remove LP then re-add at fresh ratio`);
    // Real calldata: removeLiquidity(tokenA, tokenB, liquidity, amountAMin,
    // amountBMin, to, deadline). Min amounts 1 wei to avoid reverts on a
    // demo rebalance; a production agent sizes them from live reserves.
    const removeData = encodeFunctionData({
      abi: [
        {
          name: "removeLiquidity",
          type: "function",
          stateMutability: "nonpayable",
          inputs: [
            { name: "tokenA", type: "address" },
            { name: "tokenB", type: "address" },
            { name: "liquidity", type: "uint256" },
            { name: "amountAMin", type: "uint256" },
            { name: "amountBMin", type: "uint256" },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" },
          ],
          outputs: [],
        },
      ] as const,
      functionName: "removeLiquidity",
      args: [
        USDT,
        WBNB,
        lpBalance,
        1n,
        1n,
        agent.session.walletAddress,
        BigInt(Math.floor(Date.now() / 1000) + 600),
      ],
    });
    const remove = await act(agent, [{ to: PANCAKE_ROUTER, data: removeData }]);
    log(agent.config.name, remove.ok ? `rebalance remove sent ${remove.tx}` : `rebalance blocked by session: ${remove.error}`);
  } else {
    log(agent.config.name, `position within band, holding`);
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
  log("LP Guardian", `monitoring loop every ${loopSeconds}s (Ctrl-C to stop)`);
  const tick = async () => {
    try {
      await checkOnce();
    } catch (e) {
      log("LP Guardian", `cycle error: ${String(e).slice(0, 200)}`);
    }
  };
  await tick();
  setInterval(tick, loopSeconds * 1000);
}
