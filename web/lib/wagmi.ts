import { http, createConfig } from "wagmi";
import { injected, walletConnect } from "@wagmi/connectors";
import { bscTestnet } from "wagmi/chains";

// GuardRail runs on BSC testnet (chain 97) during the hackathon build.
// Swap to bsc for mainnet once agents are live there.
export const wagmiConfig = createConfig({
  chains: [bscTestnet],
  connectors: [
    injected({ shimDisconnect: true }),
    walletConnect({
      projectId: "00000000000000000000000000000000", // placeholder — set a real WalletConnect project id for production
      showQrModal: false,
    }),
  ],
  transports: {
    [bscTestnet.id]: http("https://bsc-testnet-rpc.publicnode.com"),
  },
  ssr: true,
});
