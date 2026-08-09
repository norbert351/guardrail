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

export const PANCAKE_ROUTER: Address = "0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3";
export const WBNB: Address = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";
export const EXPLORER = "https://testnet.bscscan.com/tx/";
export const WALLET = "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as Address;

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
