import { NextResponse } from "next/server";
import { createPublicClient, http, formatEther, type Address, type Chain } from "viem";

/**
 * GET /api/hire/status
 *
 * Read-only live check of the ERC-8183 hire rail on BSC testnet:
 *   - is the OptimisticPolicy whitelisted on the EvaluatorRouter? (testnet's
 *     router was upgraded and its whitelist is currently empty, which makes
 *     registerJob revert with PolicyNotWhitelisted)
 *   - does the GuardRail buyer wallet hold any $U?
 *
 * The UI uses this to tell the user the truth about whether hiring can
 * actually settle onchain right now, instead of letting the button fail.
 */
export async function GET() {
  const TESTNET = {
    chainId: 97,
    rpc: "https://bsc-testnet-rpc.publicnode.com",
    router: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25" as Address,
    policy: "0x4F4678D4439feC812Ac7674Bb3Efb4C8f5Fb78A6" as Address,
    commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE" as Address,
    uToken: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address,
    buyer: "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as Address,
  };

  const client = createPublicClient({
    chain: { id: TESTNET.chainId, name: "BSC Testnet" } as Chain,
    transport: http(TESTNET.rpc, { timeout: 10_000 }),
  });

  const POLICY_WHITELIST_ABI = [
    { name: "policyWhitelist", type: "function", stateMutability: "view", inputs: [{ name: "policy", type: "address" }], outputs: [{ type: "bool" }] },
  ] as const;
  const BALANCE_ABI = [
    { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  ] as const;
  const COUNTER_ABI = [
    { name: "jobCounter", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  ] as const;

  const policyWhitelisted = await client
    .readContract({ address: TESTNET.router, abi: POLICY_WHITELIST_ABI, functionName: "policyWhitelist", args: [TESTNET.policy] })
    .catch(() => undefined);

  const buyerU = await client
    .readContract({ address: TESTNET.uToken, abi: BALANCE_ABI, functionName: "balanceOf", args: [TESTNET.buyer] })
    .then((n) => formatEther(n as bigint))
    .catch(() => undefined);

  const jobCounter = await client
    .readContract({ address: TESTNET.commerce, abi: COUNTER_ABI, functionName: "jobCounter" })
    .then((n) => String(n))
    .catch(() => undefined);

  const canHire = policyWhitelisted === true;
  return NextResponse.json({
    chain: "BSC testnet (97)",
    policyWhitelisted,
    buyerUSBalance: buyerU,
    jobCounter,
    canHire,
    note: canHire
      ? "ERC-8183 hire rail is live on testnet."
      : "Testnet EvaluatorRouter has an empty policy whitelist (it was upgraded and the whitelist state was lost). registerJob reverts with PolicyNotWhitelisted until the router owner re-whitelists the OptimisticPolicy. Mainnet has it whitelisted and the flow is proven there.",
  });
}
