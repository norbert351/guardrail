import { http, createConfig } from "wagmi";
import { bscTestnet } from "wagmi/chains";

// GuardRail runs on BSC testnet (chain 97) during the hackathon build.
// Swap to bsc for mainnet once agents are live there.
export const wagmiConfig = createConfig({
  chains: [bscTestnet],
  transports: {
    [bscTestnet.id]: http("https://bsc-testnet-rpc.publicnode.com"),
  },
  ssr: true,
});
