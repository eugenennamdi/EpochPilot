import { createConfig, http } from "wagmi";
import { mezoMainnet, mezoTestnet } from "./chains";

export const wagmiConfig = createConfig({
  chains: [mezoMainnet, mezoTestnet],
  multiInjectedProviderDiscovery: true, // Only discover installed EIP-6963 wallets
  connectors: [],
  transports: {
    [mezoMainnet.id]: http("https://rpc-http.mezo.boar.network"),
    [mezoTestnet.id]: http("https://rpc.test.mezo.org"),
  },
  ssr: true,
});
