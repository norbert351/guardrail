// Onchain addresses for GuardRail on BSC MAINNET (chain 56 / v2 marketplace).
// Overridable via env (GUARDRAIL_CHAIN_ID / KEYSTORE / MARKETPLACE) but the
// defaults are the deployed mainnet v2 stack the submission targets.
export const CHAIN_ID = Number(process.env.GUARDRAIL_CHAIN_ID ?? 56);

export const ALTANA_KEYSTORE =
  (process.env.GUARDRAIL_KEYSTORE ??
    "0x6572427ED530BadcF7375Cf9A4709D8d2b0E7E0a") as `0x${string}`;

// GuardRailMarketplace v2 deployment on BSC mainnet (chain 56).
export const MARKETPLACE =
  (process.env.GUARDRAIL_MARKETPLACE ??
    "0xb7c80f5154952E48f6E1548282343000c45b80d6") as `0x${string}`;

// The live demo agent wallet (from the GuardRail demo run).
export const DEMO_AGENT_WALLET =
  "0xa847F3BBF69e8A888b59BC8729ce787E0dB5be97" as `0x${string}`;

export const CATEGORIES = [
  { id: 0, name: "Rebalancing", blurb: "Manages LP ranges, resets positions automatically" },
  { id: 1, name: "Grid Trading", blurb: "Places and manages automated grid orders" },
  { id: 2, name: "Yield Optimisation", blurb: "Routes liquidity to the highest available APR" },
  { id: 3, name: "Health Factor Monitoring", blurb: "Protects lending positions from liquidation" },
] as const;

export const MARKETPLACE_ABI = [
  {
    name: "list",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "category", type: "uint8" },
      { name: "name", type: "string" },
      { name: "agentWallet", type: "address" },
      { name: "sessionKeyId", type: "bytes32" },
      {
        name: "cap",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "limit", type: "uint256" },
          { name: "period", type: "uint256" },
        ],
      },
      { name: "allowlist", type: "address[]" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "listingCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "toggleActive",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "active", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "unlist",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    name: "listingSummary",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "_id", type: "uint256" },
      { name: "category", type: "uint8" },
      { name: "name", type: "string" },
      { name: "agentWallet", type: "address" },
      { name: "sessionKeyId", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "listedAt", type: "uint256" },
    ],
  },
  {
    name: "verifyLive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "isActive",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "trustScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
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
{
    name: "stats",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "hires", type: "uint32" },
      { name: "ratingSum", type: "uint256" },
      { name: "ratingCount", type: "uint32" },
    ],
  },
  {
    name: "recordHire",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    name: "rate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "score", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

export const KEYSTORE_ABI = [
  {
    name: "isValidKey",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "keyId", type: "bytes32" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
