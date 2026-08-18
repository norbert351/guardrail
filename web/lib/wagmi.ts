import { http, createConfig } from "wagmi";
import { injected } from "@wagmi/connectors";
import { bscTestnet } from "wagmi/chains";

// GuardRail runs on BSC testnet (chain 97) during the hackathon build.
// Swap to bsc for mainnet once agents are live there.
//
// No WalletConnect projectId needed: we intentionally use native EIP-1193
// injected connectors for the wallets we support (MetaMask, Rabby, OKX,
// Trust). Each targets that wallet's provider via its feature flag, so a
// user just needs the wallet's browser extension installed — no registry,
// no relay, no project id. A plain injected() fallback catches any other
// installed wallet (EIP-6963).
export const wagmiConfig = createConfig({
  chains: [bscTestnet],
  connectors: [
    injected({ target: "metaMask", shimDisconnect: true }),
    injected({ target: "rabby" }),
    injected({ target: "okxWallet" }),
    injected({ target: "trust" }),
  ],
  transports: {
    [bscTestnet.id]: http("https://bsc-testnet-rpc.publicnode.com"),
  },
  ssr: true,
});
