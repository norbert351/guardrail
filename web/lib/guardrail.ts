// Onchain addresses for GuardRail on BSC testnet (chain 97).
// The marketplace contract is deployed after the live demo run; until then
// the page falls back to showing the verified-onchain flow with the real
// Altana KeyStore and the demo wallet.

export const CHAIN_ID = 97;

export const ALTANA_KEYSTORE =
  "0x6b8361C29d05D498b1a12B54A37310f94171E94A" as `0x${string}`;

// GuardRailMarketplace deployment on BSC testnet (chain 97).
export const MARKETPLACE =
  "0x0e111C58E488fE3647F0b45011Ba7334d163E566" as `0x${string}`;

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
