import { NETWORKS, type Network } from "./networks";

interface BlockHeightResult {
  blockHeight: number;
  source: string;
}

interface BlockTimeResult {
  avgBlockTimeMs: number;
  source: string;
  sampleSize: number;
}

/**
 * Fetch the current block height from Ethereum JSON RPC
 */
async function fetchBlockHeightFromEthRpc(rpcUrl: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return parseInt(data.result, 16);
}

/**
 * Fetch block timestamp from Ethereum JSON RPC
 */
async function fetchBlockTimestampFromEthRpc(
  rpcUrl: string,
  blockNumber: number
): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: ["0x" + blockNumber.toString(16), false],
      id: 1,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  if (!data.result) throw new Error("Block not found");
  return parseInt(data.result.timestamp, 16);
}

/**
 * Fetch the current block height from Tendermint RPC
 */
async function fetchBlockHeightFromTendermint(
  tendermintUrl: string
): Promise<number> {
  const res = await fetch(`${tendermintUrl}/status`);
  const data = await res.json();
  return parseInt(data.result.sync_info.latest_block_height, 10);
}

/**
 * Fetch block time info from Tendermint RPC (uses last N blocks)
 */
async function fetchBlockTimeFromTendermint(
  tendermintUrl: string,
  sampleSize: number = 100
): Promise<{ avgBlockTimeMs: number; latestHeight: number }> {
  const statusRes = await fetch(`${tendermintUrl}/status`);
  const statusData = await statusRes.json();
  const latestHeight = parseInt(
    statusData.result.sync_info.latest_block_height,
    10
  );
  const latestTime = new Date(
    statusData.result.sync_info.latest_block_time
  ).getTime();

  const earlierHeight = Math.max(1, latestHeight - sampleSize);
  const blockRes = await fetch(
    `${tendermintUrl}/block?height=${earlierHeight}`
  );
  const blockData = await blockRes.json();
  const earlierTime = new Date(
    blockData.result.block.header.time
  ).getTime();

  const blocksDiff = latestHeight - earlierHeight;
  const timeDiffMs = latestTime - earlierTime;

  return {
    avgBlockTimeMs: timeDiffMs / blocksDiff,
    latestHeight,
  };
}

/**
 * Fetch latest block from Cosmos API
 */
async function fetchBlockHeightFromCosmosApi(
  apiUrl: string
): Promise<{ height: number; time: string }> {
  const res = await fetch(`${apiUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  const data = await res.json();
  return {
    height: parseInt(data.block.header.height, 10),
    time: data.block.header.time,
  };
}

/**
 * Fetch a specific block from Cosmos API
 */
async function fetchBlockFromCosmosApi(
  apiUrl: string,
  height: number
): Promise<{ height: number; time: string }> {
  const res = await fetch(
    `${apiUrl}/cosmos/base/tendermint/v1beta1/blocks/${height}`
  );
  const data = await res.json();
  return {
    height: parseInt(data.block.header.height, 10),
    time: data.block.header.time,
  };
}

/**
 * Try calling a function with multiple URLs, returning the first success
 */
async function tryMultiple<T>(
  urls: string[],
  fn: (url: string) => Promise<T>
): Promise<{ result: T; url: string }> {
  const errors: Error[] = [];
  for (const url of urls) {
    try {
      const result = await fn(url);
      return { result, url };
    } catch (e) {
      errors.push(e as Error);
    }
  }
  throw new Error(
    `All endpoints failed: ${errors.map((e) => e.message).join(", ")}`
  );
}

export interface BlockEstimate {
  currentBlock: number;
  targetBlock: number;
  blocksRemaining: number;
  avgBlockTimeMs: number;
  estimatedTimeMs: number;
  estimatedDate: Date;
  sources: {
    ethRpc: { blockHeight: number; url: string } | null;
    tendermint: {
      blockHeight: number;
      avgBlockTimeMs: number;
      url: string;
    } | null;
    cosmosApi: { blockHeight: number; url: string } | null;
  };
  confidence: "high" | "medium" | "low";
}

/**
 * Main estimation function - uses all three sources for redundancy
 */
export async function estimateBlockTime(
  network: Network,
  targetBlock: number
): Promise<BlockEstimate> {
  const { currentBlock, avgBlockTimeMs, sources, confidence } =
    await gatherNetworkData(network);

  const blocksRemaining = targetBlock - currentBlock;

  if (blocksRemaining <= 0) {
    throw new Error(
      `Target block ${targetBlock} has already been reached. Current block is ${currentBlock}.`
    );
  }

  const estimatedTimeMs = blocksRemaining * avgBlockTimeMs;
  const estimatedDate = new Date(Date.now() + estimatedTimeMs);

  return {
    currentBlock,
    targetBlock,
    blocksRemaining,
    avgBlockTimeMs,
    estimatedTimeMs,
    estimatedDate,
    sources,
    confidence,
  };
}

export interface TimeToBlockEstimate {
  currentBlock: number;
  estimatedBlock: number;
  blocksAway: number;
  avgBlockTimeMs: number;
  targetDate: Date;
  timeFromNowMs: number;
  sources: BlockEstimate["sources"];
  confidence: "high" | "medium" | "low";
}

/**
 * Reverse estimation: given a target time, estimate which block will be produced
 */
export async function estimateBlockAtTime(
  network: Network,
  targetDate: Date
): Promise<TimeToBlockEstimate> {
  const { currentBlock, avgBlockTimeMs, sources, confidence } =
    await gatherNetworkData(network);

  const timeFromNowMs = targetDate.getTime() - Date.now();

  if (timeFromNowMs <= 0) {
    throw new Error("Target time must be in the future.");
  }

  const blocksAway = Math.floor(timeFromNowMs / avgBlockTimeMs);
  const estimatedBlock = currentBlock + blocksAway;

  return {
    currentBlock,
    estimatedBlock,
    blocksAway,
    avgBlockTimeMs,
    targetDate,
    timeFromNowMs,
    sources,
    confidence,
  };
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

function average(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Shared helper: fetches current block heights and avg block times from all 3 sources
 */
async function gatherNetworkData(network: Network) {
  const config = NETWORKS[network];

  const [ethResult, tendermintResult, cosmosResult] = await Promise.allSettled([
    (async () => {
      const { result: height, url } = await tryMultiple(
        config.rpcUrls,
        fetchBlockHeightFromEthRpc
      );
      const sampleSize = 100;
      const earlierBlock = Math.max(0, height - sampleSize);
      const [latestTs, earlierTs] = await Promise.all([
        fetchBlockTimestampFromEthRpc(url, height),
        fetchBlockTimestampFromEthRpc(url, earlierBlock),
      ]);
      const avgBlockTimeMs =
        ((latestTs - earlierTs) * 1000) / (height - earlierBlock);
      return { height, avgBlockTimeMs, url };
    })(),
    (async () => {
      const { result, url } = await tryMultiple(
        config.tendermintRpcUrls,
        async (tUrl) => fetchBlockTimeFromTendermint(tUrl, 200)
      );
      return { ...result, url };
    })(),
    (async () => {
      const { result: latest, url } = await tryMultiple(
        config.cosmosApiUrls,
        fetchBlockHeightFromCosmosApi
      );
      const sampleSize = 100;
      const earlierHeight = Math.max(1, latest.height - sampleSize);
      const earlier = await fetchBlockFromCosmosApi(url, earlierHeight);
      const timeDiffMs =
        new Date(latest.time).getTime() - new Date(earlier.time).getTime();
      const avgBlockTimeMs = timeDiffMs / (latest.height - earlierHeight);
      return { height: latest.height, avgBlockTimeMs, url };
    })(),
  ]);

  const heights: number[] = [];
  const blockTimes: number[] = [];

  const sources: BlockEstimate["sources"] = {
    ethRpc: null,
    tendermint: null,
    cosmosApi: null,
  };

  if (ethResult.status === "fulfilled") {
    heights.push(ethResult.value.height);
    blockTimes.push(ethResult.value.avgBlockTimeMs);
    sources.ethRpc = {
      blockHeight: ethResult.value.height,
      url: ethResult.value.url,
    };
  }

  if (tendermintResult.status === "fulfilled") {
    heights.push(tendermintResult.value.latestHeight);
    blockTimes.push(tendermintResult.value.avgBlockTimeMs);
    sources.tendermint = {
      blockHeight: tendermintResult.value.latestHeight,
      avgBlockTimeMs: tendermintResult.value.avgBlockTimeMs,
      url: tendermintResult.value.url,
    };
  }

  if (cosmosResult.status === "fulfilled") {
    heights.push(cosmosResult.value.height);
    blockTimes.push(cosmosResult.value.avgBlockTimeMs);
    sources.cosmosApi = {
      blockHeight: cosmosResult.value.height,
      url: cosmosResult.value.url,
    };
  }

  if (heights.length === 0) {
    throw new Error("All data sources failed. Please try again later.");
  }

  const currentBlock = median(heights);
  const avgBlockTimeMs = average(blockTimes);

  let confidence: "high" | "medium" | "low";
  if (heights.length >= 3) confidence = "high";
  else if (heights.length >= 2) confidence = "medium";
  else confidence = "low";

  return { currentBlock, avgBlockTimeMs, sources, confidence };
}
