/**
 * GuardRail MCP server — JSON-RPC over POST at /api/mcp.
 *
 * Exposes the marketplace to AGENTS, not only humans: an agent (or an MCP host
 * like Claude/Cursor) can search listings, read the real scope, and pull a
 * transaction-hash-backed track record. This is the software-callable surface
 * the ERC-8004 ecosystem expects.
 *
 * Design rule, deliberately: NO tool can spend or move funds. `hire_info`
 * returns the exact contract call a human must sign in their own wallet — the
 * server never holds a key and never returns a signature. Same principle as the
 * scoped-session model itself.
 */

import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { bsc } from "viem/chains";
import { ALTANA_KEYSTORE, CATEGORIES, KEYSTORE_ABI, MARKETPLACE, MARKETPLACE_ABI } from "@/lib/guardrail";
import { verifyAllActivity, summariseListing } from "@/lib/quality";
import { enumerateRegistry, readAgent, IDENTITY_REGISTRY } from "@/lib/registry";

export const dynamic = "force-dynamic";

const RPC = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";

const TOOLS = [
  {
    name: "search_agents",
    description:
      "Search GuardRail's live BSC mainnet agent marketplace. Returns the four listed agents with category, onchain trustScore, declared scope (allowlist width, spend cap) and the session's live status. Optionally filter by a plain-language query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional free-text filter over agent name/category." },
        category: { type: "string", description: "Optional category: Rebalancing | Grid Trading | Yield Optimisation | Health Factor Monitoring." },
      },
    },
  },
  {
    name: "get_agent",
    description:
      "Full detail for one GuardRail listing: the exact onchain scope (allowlist, spend cap token/limit/period), liveness cross-checked against the Altana KeyStore, trustScore, ERC-8004 identity and the x402 price.",
    inputSchema: {
      type: "object",
      properties: { listingId: { type: "number", description: "GuardRail listing id (1-4)." } },
      required: ["listingId"],
    },
  },
  {
    name: "get_track_record",
    description:
      "The agent's real onchain track record: hires, ratings, and the list of verified mainnet transactions with block numbers, gas and BscScan links. Every row is re-verified against the chain at call time.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_registry_agents",
    description:
      "Enumerate agents registered on the BSC mainnet ERC-8004 IdentityRegistry — anyone's, not only GuardRail's. Reads the contract directly; no submission or approval.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "number", description: "Start id (default 345000)." },
        to: { type: "number", description: "End id (default 345100; range capped at 400)." },
      },
    },
  },
  {
    name: "hire_info",
    description:
      "How to hire a listing. Returns the exact contract call the USER must sign in their own wallet, plus the x402 endpoint and price for a paid report. This tool never signs, never spends, and never holds a key.",
    inputSchema: {
      type: "object",
      properties: { listingId: { type: "number", description: "GuardRail listing id (1-4)." } },
      required: ["listingId"],
    },
  },
] as const;

/**
 * Normalise a viem read that may come back as a positional array (for a
 * multi-output function) or as a named-key object (for a struct output). Being
 * explicit about BOTH shapes avoids the "reading 'length' of undefined" class of
 * bug that a blind named-property cast produces.
 */
function tupleOf<T extends readonly unknown[]>(v: unknown, keys: readonly string[]): T {
  if (Array.isArray(v)) return v as unknown as T;
  const o = v as Record<string, unknown>;
  return keys.map((k) => o[k]) as unknown as T;
}

async function listingRows() {
  const client = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 15_000 }) });
  const count = (await client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "listingCount" })) as bigint;
  const activity = await verifyAllActivity();
  const now = Math.floor(Date.now() / 1000);
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

  return Promise.all(
    ids.map(async (id) => {
      const [summary, scope, trust, stats] = await Promise.all([
        client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "listingSummary", args: [id] }),
        client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "scopeAudit", args: [id] }),
        client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "trustScore", args: [id] }),
        client.readContract({ address: MARKETPLACE, abi: MARKETPLACE_ABI, functionName: "stats", args: [id] }),
      ]);

      // listingSummary: [_id, category, name, agentWallet, sessionKeyId, operator, listedAt]
      const s = tupleOf<[bigint, number, string, `0x${string}`, `0x${string}`, `0x${string}`, bigint]>(
        summary,
        ["_id", "category", "name", "agentWallet", "sessionKeyId", "operator", "listedAt"],
      );
      // scopeAudit: [agentWallet, sessionKeyId, capToken, capLimit, capPeriod, allowlist[], active, live]
      const sc = tupleOf<[`0x${string}`, `0x${string}`, `0x${string}`, bigint, bigint, readonly `0x${string}`[], boolean, boolean]>(
        scope,
        ["agentWallet", "sessionKeyId", "capToken", "capLimit", "capPeriod", "allowlist", "active", "live"],
      );
      // stats: [hires, ratingSum, ratingCount]
      const st = tupleOf<[number, bigint, number]>(stats, ["hires", "ratingSum", "ratingCount"]);

      let keyStoreLive: boolean | null = null;
      try {
        keyStoreLive = (await client.readContract({
          address: ALTANA_KEYSTORE,
          abi: KEYSTORE_ABI,
          functionName: "isValidKey",
          args: [s[3], s[4]],
        })) as boolean;
      } catch {
        keyStoreLive = null;
      }

      const q = summariseListing({
        listingId: Number(id),
        name: s[2],
        category: Number(s[1]),
        trustScore: trust as bigint,
        listedAt: s[6],
        allowlist: sc[5] ?? [],
        capLimit: sc[3],
        capPeriod: sc[4],
        capToken: sc[2],
        live: Boolean(sc[7]),
        active: sc[6],
        hires: Number(st[0]),
        ratingSum: st[1],
        ratingCount: Number(st[2]),
        agentWallet: s[3],
        activity,
        nowSeconds: now,
      });
      return { ...q, keyStoreLive, agree: keyStoreLive === null ? null : keyStoreLive === Boolean(sc[7]) };
    }),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(name: string, args: Record<string, any>) {
  if (name === "search_agents") {
    const rows = await listingRows();
    let out = rows;
    if (args.category) out = out.filter((r) => CATEGORIES[r.category as 0 | 1 | 2 | 3]?.name === args.category);
    if (args.query) {
      const q = String(args.query).toLowerCase();
      out = out.filter((r) => r.name.toLowerCase().includes(q) || (CATEGORIES[r.category as 0 | 1 | 2 | 3]?.name ?? "").toLowerCase().includes(q));
    }
    return {
      chainId: 56,
      marketplace: MARKETPLACE,
      count: out.length,
      agents: out.map((r) => ({
        listingId: r.listingId,
        name: r.name,
        category: CATEGORIES[r.category as 0 | 1 | 2 | 3]?.name,
        trustScore: r.trustScore,
        live: r.scope.live,
        keyStoreAgrees: (r as { agree?: boolean | null }).agree,
        scope: r.scope,
        hires: r.hires,
        avgRating: r.avgRating,
        insufficientHistory: r.insufficientHistory,
      })),
    };
  }

  if (name === "get_agent") {
    const id = Number(args.listingId);
    const rows = await listingRows();
    const r = rows.find((x) => x.listingId === id);
    if (!r) throw new Error(`listing ${id} not found (have ${rows.map((x) => x.listingId).join(", ")})`);
    return {
      ...r,
      erc8004: { registry: IDENTITY_REGISTRY, agentId: 345083 + id, note: "identity owned by the agent wallet" },
      keyStore: ALTANA_KEYSTORE,
      x402: { endpoint: `/api/x402/${{ 0: "lp", 1: "grid", 2: "yield", 3: "health" }[r.category] ?? "health"}`, priceU: "0.1" },
    };
  }

  if (name === "get_track_record") {
    const activity = await verifyAllActivity();
    const rows = await listingRows();
    const verified = activity.filter((a) => a.verified);
    return {
      chainId: 56,
      verifiedCount: verified.length,
      recordedCount: activity.length,
      listings: rows.map((r) => ({ listingId: r.listingId, name: r.name, hires: r.hires, ratings: r.ratings, avgRating: r.avgRating, trustScore: r.trustScore })),
      transactions: verified.map((a) => ({
        kind: a.kind,
        agent: a.agentName,
        listingId: a.listingId ?? null,
        detail: a.detail,
        txHash: a.txHash,
        block: a.blockNumber,
        gasUsed: a.gasUsed,
        explorer: a.explorer,
      })),
      note: "every row re-verified with getTransaction + getTransactionReceipt at call time; unverified hashes are omitted, never faked.",
    };
  }

  if (name === "list_registry_agents") {
    const from = Number(args.from ?? 345000);
    const to = Number(args.to ?? 345100);
    if (to < from || to - from > 400) throw new Error("invalid range: need from <= to and to - from <= 400");
    const { agents, live } = await enumerateRegistry({ from, to });
    return { chainId: 56, registry: IDENTITY_REGISTRY, scanned: [from, to], live, agents };
  }

  if (name === "hire_info") {
    const id = Number(args.listingId);
    const rows = await listingRows();
    const r = rows.find((x) => x.listingId === id);
    if (!r) throw new Error(`listing ${id} not found`);
    return {
      listingId: id,
      agentWallet: r.agentWallet,
      howToHire: {
        step1: "Connect your wallet to https://guardrail-delta.vercel.app/agents",
        step2: `Call recordHire(${id}) on ${MARKETPLACE} (chain 56) — records the hire onchain. The UI does this from YOUR wallet.`,
        step3: `Or pay 0.1 $U for a live report at POST /api/x402/${{ 0: "lp", 1: "grid", 2: "yield", 3: "health" }[r.category] ?? "health"} (EIP-3009, your signature).`,
      },
      scopeYoureTrusting: r.scope,
      escrow: {
        protocol: "ERC-8183",
        kernel: "0xEa4DAa3100A767e86FDed867729ae7446476EBA6",
        note: "buyer-side escrow: the kernel holds your $U until the provider delivers and the optimistic dispute window closes.",
      },
      neverSignedByUs:
        "GuardRail never holds a key and never signs for you. Any tool response containing a signature would be a bug.",
    };
  }

  throw new Error(`unknown tool: ${name}`);
}

export async function GET() {
  return NextResponse.json({
    name: "guardrail-marketplace",
    version: "1.0.0",
    protocol: "mcp",
    transport: "http-jsonrpc",
    endpoint: "/api/mcp",
    description: "GuardRail — agents that can only act inside the limits you set. Read-only surface: no tool can spend funds.",
    tools: TOOLS,
  });
}

export async function POST(req: Request) {
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const { method, id } = body;
  const reply = (result: unknown) => NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });

  try {
    if (method === "initialize") {
      return reply({
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "guardrail-marketplace", version: "1.0.0" },
      });
    }
    if (method === "tools/list") return reply({ tools: TOOLS });
    if (method === "tools/call") {
      const p = (body.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
      if (!p.name) throw new Error("tools/call requires params.name");
      const result = await callTool(p.name, p.arguments ?? {});
      return reply({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }
    return NextResponse.json(
      { jsonrpc: "2.0", id: id ?? null, error: { code: -32601, message: `Method not found: ${method}` } },
      { status: 404 },
    );
  } catch (e) {
    return NextResponse.json({
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code: -32603, message: String((e as Error)?.message ?? e).slice(0, 300) },
    });
  }
}
