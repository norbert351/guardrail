/**
 * GuardRail ERC-8004 agent identity registration.
 *
 * Registers each GuardRail agent as an onchain ERC-8004 identity on the BSC
 * testnet IdentityRegistry (0x8004A818...). The registration mints an agent
 * NFT whose tokenURI is an EIP-8004 registration-v1 file (base64 data URI)
 * carrying the agent name, description, and its A2A/x402 endpoints.
 *
 * This makes the agents discoverable on 8004scan and any ERC-8004 indexer,
 * independent of GuardRail's own marketplace — the standard identity layer
 * the hackathon's ERC-8004 track expects.
 *
 * Usage: tsx src/register-8004.ts
 */

import { createPublicClient, createWalletClient, http, encodeFunctionData, decodeEventLog, bytesToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const RPC = "https://bsc-testnet-rpc.publicnode.com";
const EXPLORER = "https://testnet.bscscan.com/tx/";
const WALLET: Address = "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97";

const AGENTS = [
  { name: "GuardRail LP Guardian", category: "Rebalancing", desc: "Manages PancakeSwap LP ranges and resets positions when the ratio drifts outside a band.", endpoint: "http://127.0.0.1:8787/v1/agents/lp" },
  { name: "GuardRail GridBot", category: "Grid Trading", desc: "Runs a bounded grid strategy on WBNB/USDT, firing scoped swaps at grid levels.", endpoint: "http://127.0.0.1:8787/v1/agents/grid" },
  { name: "GuardRail Yield Router", category: "Yield Optimisation", desc: "Compares live APRs across markets and routes liquidity to the best one.", endpoint: "http://127.0.0.1:8787/v1/agents/yield" },
  { name: "GuardRail Health Guard", category: "Health Factor Monitoring", desc: "Watches lending positions and protects them from liquidation.", endpoint: "http://127.0.0.1:8787/v1/agents/health" },
] as const;

const REGISTER_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentURI", type: "string" },
      {
        name: "metadata",
        type: "tuple[]",
        components: [
          { name: "metadataKey", type: "string" },
          { name: "metadataValue", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "getAgentWallet",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
] as const;

function loadAdminKey(): `0x${string}` {
  const f = join(process.cwd(), ".guardrail-state.json");
  if (!existsSync(f)) throw new Error("no .guardrail-state.json");
  return JSON.parse(readFileSync(f, "utf8")).adminKey as `0x${string}`;
}

function buildAgentUri(name: string, desc: string, endpoint: string): string {
  const file = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name,
    description: desc,
    image: "",
    services: [{ name: "x402", endpoint, version: "0.3.0" }],
    registrations: [],
    supportedTrust: ["https://eips.ethereum.org/EIPS/eip-3009"],
  };
  const b64 = Buffer.from(JSON.stringify(file, null, 0)).toString("base64");
  return `data:application/json;base64,${b64}`;
}

async function main() {
  const key = loadAdminKey();
  const account = privateKeyToAccount(key);
  const pubClient = createPublicClient({ chain: { id: 97, name: "BSC Testnet" } as any, transport: http(RPC, { timeout: 15_000 }) });
  const walletClient = createWalletClient({ account, chain: { id: 97, name: "BSC Testnet" } as any, transport: http(RPC, { timeout: 15_000 }) });

  console.log(`ERC-8004 registry: ${REGISTRY}`);
  console.log(`registering from wallet ${account.address}\n`);

  for (const agent of AGENTS) {
    const uri = buildAgentUri(agent.name, agent.desc, agent.endpoint);
    const data = encodeFunctionData({
      abi: REGISTER_ABI,
      functionName: "register",
      args: [
        uri,
        [
          { metadataKey: "category", metadataValue: bytesToHex(new TextEncoder().encode(agent.category)) },
          { metadataKey: "marketplace", metadataValue: bytesToHex(new TextEncoder().encode("0x57039e8fea975C7C819Fe03b50c733d38f38387D")) },
        ],
      ],
    });

    // Register via a direct EOA tx (the registry mints to the sender).
    const hash = await walletClient.sendTransaction({
      to: REGISTRY,
      data,
    });
    console.log(`${agent.name}: registering... ${EXPLORER}${hash}`);

    // Wait for confirmation, then pull the agentId from the Registered event.
    const receipt = await pubClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    let agentId: bigint | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({
          abi: [
            {
              type: "event",
              name: "Registered",
              inputs: [
                { name: "agentId", type: "uint256", indexed: true },
                { name: "agentURI", type: "string", indexed: false },
                { name: "owner", type: "address", indexed: true },
              ],
            },
          ],
          data: log.data,
          topics: log.topics,
        });
        if (ev.eventName === "Registered") {
          agentId = ev.args.agentId;
          break;
        }
      } catch {
        /* not the Registered log */
      }
    }

    if (agentId !== undefined) {
      const owner = await pubClient.readContract({ address: REGISTRY, abi: REGISTER_ABI, functionName: "ownerOf", args: [agentId] });
      const uriBack = await pubClient.readContract({ address: REGISTRY, abi: REGISTER_ABI, functionName: "tokenURI", args: [agentId] }).catch(() => "");
      console.log(`  -> agentId ${agentId}, owner ${owner}, uri len ${uriBack.length}`);
    } else {
      console.log(`  -> tx confirmed but agentId not decoded (status ${receipt.status})`);
    }
    console.log("");
  }

  console.log("All GuardRail agents registered on the ERC-8004 registry.");
}

main().catch((e) => {
  console.error("registration failed:", e);
  process.exit(1);
});
