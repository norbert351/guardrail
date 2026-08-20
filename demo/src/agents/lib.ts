/**
 * GuardRail agent shared library.
 *
 * Each agent:
 *   - loads its OWN session key (private key held by the agent process),
 *   - reads real onchain state directly against the RPC,
 *   - decides with a transparent rule,
 *   - executes within its scoped session (allowlist + spend cap), and
 *   - logs every step with explorer links.
 *
 * The session key is the agent's onchain identity: it is registered in the
 * Altana KeyStore and bound to a GuardRailMarketplace listing. Revoke it and
 * the agent's execute() reverts immediately.
 */

import {
  createClient,
  BNB_TESTNET,
  signerFromPrivateKey,
  type Session,
} from "@altananetwork/sdk";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeClient, ClaudeError, type ClaudeResult } from "../llm.js";

export const PANCAKE_ROUTER: Address = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
export const WBNB: Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
export const EXPLORER = "https://testnet.bscscan.com/tx/";
export const WALLET = "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as Address;

/** Load demo/.env into process.env (existing vars win). Never prints values. */
export function loadEnv(): void {
  const file = join(process.cwd(), ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] === "ANTHROPIC_AUTH_TOKEN" && process.env[m[1]]) continue;
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

/**
 * Ask Claude (AgentRouter gateway, claude-opus-4-8) for an advisory decision.
 * The agent stays the decision maker: this returns a recommendation the
 * agent may ignore, and every execution still passes through the scoped
 * session (allowlist + spend cap + expiry). On any gateway failure the
 * agent falls back to its deterministic rule — never blocks on the LLM.
 */
export async function claudeAdvise(
  agent: string,
  system: string,
  prompt: string,
): Promise<{ ok: true; result: ClaudeResult } | { ok: false; error: string }> {
  loadEnv();
  try {
    const client = new ClaudeClient({ timeoutMs: 10_000 });
    const result = await client.complete({
      system,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 400,
      temperature: 0.2,
    });
    log(agent, `claude advised (${result.model}): ${result.text.slice(0, 200)}`);
    return { ok: true, result };
  } catch (e) {
    const err = e instanceof ClaudeError ? e : new ClaudeError(0, "network", String((e as Error)?.message ?? e));
    const hint =
      err.kind === "auth" ? "auth rejected — check ANTHROPIC_AUTH_TOKEN"
      : err.kind === "model_unavailable" ? "model has no channel on gateway — switch ANTHROPIC_MODEL"
      : err.kind === "network" ? "gateway unreachable (VM IP is WAF-blocked — run from a residential IP)"
      : `gateway error ${err.status}`;
    log(agent, `claude unavailable (${hint}), falling back to deterministic rule`);
    return { ok: false, error: hint };
  }
}

// Mainnet protocol contracts, used for read-only market data (health factor,
// APRs, pool ratios). Reads are free and unlimited.
export const VENUS_VUSDT_MAINNET = "0xfD5840Cd36d94D7229439859C0112a4185BC0255" as Address;
export const VENUS_USDT_MAINNET = "0x55d398326f99059fF775485246999027B3197955" as Address;

export type AgentConfig = {
  category: number;
  listingId: number;
  name: string;
};

export type LoadedAgent = {
  config: AgentConfig;
  session: Session;
  pubClient: ReturnType<typeof createPublicClient>;
  mainnetPubClient: ReturnType<typeof createPublicClient>;
};

export function loadAgentKeys(): {
  name: string;
  category: number;
  sessionPk: Hex;
  listingId: number;
}[] {
  const file = join(process.cwd(), ".guardrail-agent-keys.json");
  if (!existsSync(file)) {
    throw new Error("no .guardrail-agent-keys.json, run provision-agents first");
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

export async function loadAgent(category: number): Promise<LoadedAgent> {
  const keys = loadAgentKeys();
  const key = keys.find((k) => k.category === category);
  if (!key) throw new Error(`no agent key for category ${category}`);

  const client = createClient({ chains: [BNB_TESTNET] });
  const signer = signerFromPrivateKey(key.sessionPk);

  // Rebuild the Session object from the persisted grant. The session key,
  // permissions and expiry must match what was committed onchain at grant
  // time (the account validator checks byte-exact session state).
  const session: Session = {
    walletAddress: WALLET,
    signer,
    publicKey: signer.publicKey as Hex,
    permissions: {
      calls: [{ to: PANCAKE_ROUTER }, { to: WBNB }],
      spend: [{ limit: 20_000_000_000_000_000n, period: "day" as const }],
    },
    expiry: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  };

  const pubClient = createPublicClient({
    chain: BNB_TESTNET.chain,
    transport: http(BNB_TESTNET.publicRpcUrl, { timeout: 10_000 }),
  });

  // Mainnet client for read-only market data (Venus APRs, real pool state).
  // Testnet RPC does not serve mainnet contracts and hangs on those reads.
  const mainnetPubClient = createPublicClient({
    chain: { id: 56, name: "BNB Smart Chain" } as any,
    transport: http("https://bsc-rpc.publicnode.com", { timeout: 10_000 }),
  });

  return {
    config: { category: key.category, listingId: key.listingId, name: key.name },
    session,
    pubClient,
    mainnetPubClient,
  };
}

export function log(agent: string, msg: string) {
  console.log(`[${new Date().toISOString()}] [${agent}] ${msg}`);
}

/** Execute a call through the agent's session. Returns the tx hash or the block reason. */
export async function act(
  agent: LoadedAgent,
  calls: { to: Address; data?: Hex; value?: bigint }[],
): Promise<{ ok: boolean; tx?: Hex; error?: string }> {
  const client = createClient({ chains: [BNB_TESTNET] });
  try {
    const r = await client.execute({ session: agent.session, calls });
    return { ok: r.status === "CONFIRMED", tx: r.transactionHash as Hex | undefined };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) };
  }
}
