/**
 * Open ERC-8004 registry read — server-side.
 *
 * GuardRail's own four listings are a curated marketplace. This module adds the
 * second half every competing entry now ships: **any agent anyone has registered
 * on the BSC mainnet ERC-8004 IdentityRegistry is discoverable**, with no
 * submission, no database and no approval step. The registry contract is the
 * source of truth; if this module fails, the curated marketplace still works.
 *
 * Enumeration note: the mainnet registry is an ERC-1967 proxy over an
 * ERC-721 that implements neither `totalSupply()` nor ERC-721 Enumerable
 * (`supportsInterface(0x780e9d63) == false`), and public BSC RPCs reject
 * `eth_getLogs`. So we enumerate the live id range by probing `ownerOf` over a
 * bounded window (in parallel chunks) and reading `tokenURI` for each hit. A
 * burned/nonexistent id reverts, which is exactly how we detect the gaps.
 */

import { createPublicClient, http, type Address } from "viem";
import { bsc } from "viem/chains";

export const IDENTITY_REGISTRY: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const RPC = process.env.BNB_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";

const REGISTRY_ABI = [
  { name: "ownerOf", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] },
  { name: "tokenURI", type: "function", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "string" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

let _client: ReturnType<typeof createPublicClient> | null = null;
function client() {
  if (!_client) _client = createPublicClient({ chain: bsc, transport: http(RPC, { timeout: 15_000 }) });
  return _client;
}

/** GuardRail's own registered identities (see demo/src/register-8004-mainnet.ts). */
export const OWN_IDS: Record<number, string> = {
  345084: "GuardRail LP Guardian",
  345085: "GuardRail GridBot",
  345086: "GuardRail Yield Router",
  345087: "GuardRail Health Guard",
};

/** Decode an EIP-8004 registration document from a `data:` URI (base64 or plain). */
export function decodeAgentUri(uri: string): Record<string, unknown> | null {
  if (!uri) return null;
  try {
    const marker = "base64,";
    if (uri.startsWith("data:application/json;base64,")) {
      const b64 = uri.slice(uri.indexOf(marker) + marker.length);
      return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, unknown>;
    }
    if (uri.startsWith("data:application/json,")) {
      return JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(",") + 1))) as Record<string, unknown>;
    }
    if (uri.startsWith("http")) return null; // remote doc: not fetched here
    return null;
  } catch {
    return null;
  }
}

export type RegistryAgent = {
  agentId: number;
  owner: string;
  name: string | null;
  description: string | null;
  category: string | null;
  services: { name?: string; endpoint?: string }[];
  x402Support: boolean | null;
  /** True when this agent is one of GuardRail's own four listings. */
  ours: boolean;
  /** GuardRail-specific scope block, when the agent declares one. */
  guardrailScope: string | null;
  registry: string;
};

/** Read one id; returns null when the id does not exist (ownerOf reverts). */
export async function readAgent(id: number): Promise<RegistryAgent | null> {
  const c = client();
  try {
    const owner = (await c.readContract({
      address: IDENTITY_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "ownerOf",
      args: [BigInt(id)],
    })) as string;

    let doc: Record<string, unknown> | null = null;
    try {
      const uri = (await c.readContract({
        address: IDENTITY_REGISTRY,
        abi: REGISTRY_ABI,
        functionName: "tokenURI",
        args: [BigInt(id)],
      })) as string;
      doc = decodeAgentUri(uri);
    } catch {
      doc = null;
    }

    const services = Array.isArray(doc?.services)
      ? (doc!.services as { name?: string; endpoint?: string }[])
      : [];
    const guardrail = doc?.guardrail as { scopeModel?: string; verify?: string } | undefined;

    return {
      agentId: id,
      owner,
      name: typeof doc?.name === "string" ? doc.name : null,
      description: typeof doc?.description === "string" ? doc.description : null,
      category: typeof doc?.category === "string" ? doc.category : null,
      services,
      x402Support: typeof doc?.x402Support === "boolean" ? doc.x402Support : null,
      ours: Boolean(OWN_IDS[id]),
      guardrailScope: guardrail ? `${guardrail.scopeModel ?? "scoped-session"} · ${guardrail.verify ?? ""}`.trim() : null,
      registry: IDENTITY_REGISTRY,
    };
  } catch {
    return null; // id not minted
  }
}

/**
 * Enumerate a bounded id window in parallel chunks. `--from`/`--count` bound the
 * work so a public RPC is never asked for an unbounded scan.
 */
export async function enumerateRegistry(opts: {
  from?: number;
  to?: number;
  concurrency?: number;
} = {}): Promise<{ agents: RegistryAgent[]; scanned: [number, number]; live: number }> {
  const from = opts.from ?? 345000;
  const to = opts.to ?? 345100;
  const concurrency = opts.concurrency ?? 20;

  const ids: number[] = [];
  for (let i = from; i <= to; i++) ids.push(i);

  const results: RegistryAgent[] = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const settled = await Promise.all(chunk.map((id) => readAgent(id)));
    for (const a of settled) if (a) results.push(a);
  }

  results.sort((a, b) => b.agentId - a.agentId);
  return { agents: results, scanned: [from, to], live: results.length };
}
