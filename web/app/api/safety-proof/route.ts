import { NextResponse } from "next/server";
import { createPublicClient, http, parseEther } from "viem";
import { bscTestnet } from "viem/chains";
import { MARKETPLACE } from "@/lib/guardrail";

export const dynamic = "force-dynamic";

const ROUTER = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
const WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
const ATTACKER = "0x00000000000000000000000000000000DeaDBeef";

// The four onchain facts a guardrail enforces, shown from the LIVE scope read.
// Scenarios don't broadcast anything — they reason over the real allowlist +
// cap pulled from the marketplace's scopeAudit() so the verdict is chain truth.
const SCENARIOS = [
  {
    id: "drain",
    label: "Drain the whole wallet",
    hint: "(transfer to an attacker address)",
    target: ATTACKER,
    valueBnb: "10",
  },
  {
    id: "call",
    label: "Call a contract outside the allowlist",
    hint: "(a random DEX, not approved)",
    target: "0x9999999999999999999999999999999999999999",
    valueBnb: "0.001",
  },
  {
    id: "cap",
    label: "Exceed the daily spend cap",
    hint: "(burn 5 BNB in one go)",
    target: ROUTER, // allowlisted, but way over the cap
    valueBnb: "5",
  },
  {
    id: "within",
    label: "Act inside the scope",
    hint: "(a small allowed call to the router)",
    target: ROUTER,
    valueBnb: "0.001",
  },
] as const;

const ABI = [
  {
    name: "scopeAudit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "agentWallet", type: "address" },
      { name: "sessionKeyId", type: "bytes32" },
      { name: "capToken", type: "address" },
      { name: "capLimit", type: "uint256" },
      { name: "capPeriod", type: "uint256" },
      { name: "allowlist", type: "address[]" },
      { name: "active", type: "bool" },
      { name: "live", type: "bool" },
    ],
  },
] as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const listingId = Number(searchParams.get("listingId") ?? "1");
  const scenarioId = searchParams.get("kind") ?? "drain";
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(process.env.BNB_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com"),
  });

  try {
    const scope = (await client.readContract({
      address: MARKETPLACE,
      abi: ABI,
      functionName: "scopeAudit",
      args: [BigInt(listingId)],
    })) as readonly [string, string, string, bigint, bigint, readonly string[], boolean, boolean];

    const [agentWallet, sessionKeyId, capToken, capLimit, capPeriod, allowlist, active, live] = scope;
    const allowlistLower = allowlist.map((a) => a.toLowerCase());
    const target = scenario.target.toLowerCase();

    const onAllowlist = allowlistLower.includes(target);
    const valueWei = parseEther(scenario.valueBnb);
    const nativeCap = capToken === "0x0000000000000000000000000000000000000000";
    const withinCap = !nativeCap || valueWei <= capLimit;

    let allowed: boolean;
    let reason: string;

    if (!onAllowlist) {
      allowed = false;
      reason = "UnauthorizedCall — contract is not in this session's allowlist";
    } else if (!withinCap) {
      allowed = false;
      reason = "Spend cap exceeded — session allows only a tiny amount per day";
    } else {
      allowed = true;
      reason = "Within scope — allowlisted target and inside the spend cap";
    }

    return NextResponse.json({
      listingId,
      scenario: scenario.id,
      label: scenario.label,
      hint: scenario.hint,
      target: scenario.target,
      valueBnb: scenario.valueBnb,
      allowed,
      reason,
      sessionLive: live,
      listingActive: active,
      capLimitBnb: nativeCap ? Number(capLimit) / 1e18 : null,
      capToken,
      allowlist,
      agentWallet,
      sessionKeyId,
    });
  } catch (err) {
    console.error("safety-proof read failed", err);
    return NextResponse.json({ error: "failed to read listing scope onchain" }, { status: 502 });
  }
}