export type Network = "XRPL_EVM_MAINNET" | "XRPL_EVM_TESTNET";

export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrls: string[];
  wsUrls: string[];
  tendermintRpcUrls: string[];
  cosmosApiUrls: string[];
}

export const NETWORKS: Record<Network, NetworkConfig> = {
  XRPL_EVM_MAINNET: {
    name: "XRPL EVM Mainnet",
    chainId: 1440002,
    rpcUrls: [
      "https://rpc.xrplevm.org",
      "https://json-rpc.xrpl.cumulo.org.es",
      "https://xrpevm-rpc.polkachu.com",
    ],
    wsUrls: [
      "https://ws.xrplevm.org",
      "https://ws.xrpl.cumulo.org.es",
    ],
    tendermintRpcUrls: [
      "https://cosmos-rpc.xrplevm.org",
      "https://xrp-rpc.polkachu.com",
      "https://rpc.xrpl.cumulo.org.es",
      "https://xrpl-rpc.stakeme.pro",
    ],
    cosmosApiUrls: [
      "https://cosmos-api.xrplevm.org",
      "https://xrp-api.polkachu.com",
      "https://api.xrpl.cumulo.org.es",
      "https://xrpl-rest.stakeme.pro",
    ],
  },
  XRPL_EVM_TESTNET: {
    name: "XRPL EVM Testnet",
    chainId: 1440001,
    rpcUrls: [
      "https://rpc.testnet.xrplevm.org",
      "https://json-rpc.xrpl.cumulo.com.es",
      "https://xrplevm-testnet-evm.itrocket.net",
    ],
    wsUrls: [
      "https://ws.testnet.xrplevm.org",
    ],
    tendermintRpcUrls: [
      "https://cosmos-rpc.testnet.xrplevm.org",
      "https://xrp-testnet-rpc.polkachu.com",
      "https://rpc.xrpl.cumulo.com.es",
      "https://xrplevm-testnet-rpc.itrocket.net",
    ],
    cosmosApiUrls: [
      "http://cosmos-api.testnet.xrplevm.org",
      "https://xrp-testnet-api.polkachu.com",
      "https://api.xrpl.cumulo.com.es",
      "https://xrplevm-testnet-api.itrocket.net",
    ],
  },
};
