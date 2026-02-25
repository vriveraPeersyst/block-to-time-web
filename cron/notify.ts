/**
 * Standalone cron script – runs on Railway with direct DB access.
 * Processes pending Slack notifications for block watches.
 *
 * Required env vars:
 *   DATABASE_URL   – Railway PostgreSQL connection string
 *   NEXT_PUBLIC_BASE_URL – public URL of the web app (for calendar links)
 */

import { PrismaClient, type NotificationTier } from "@prisma/client";
import { format } from "date-fns";

// ── Prisma ──────────────────────────────────────────────
const prisma = new PrismaClient();

// ── Types ───────────────────────────────────────────────
type Network = "XRPL_EVM_MAINNET" | "XRPL_EVM_TESTNET";

interface NetworkConfig {
  name: string;
  rpcUrls: string[];
  tendermintRpcUrls: string[];
  cosmosApiUrls: string[];
}

const NETWORKS: Record<Network, NetworkConfig> = {
  XRPL_EVM_MAINNET: {
    name: "XRPL EVM Mainnet",
    rpcUrls: [
      "https://rpc.xrplevm.org",
      "https://json-rpc.xrpl.cumulo.org.es",
      "https://xrpevm-rpc.polkachu.com",
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
    rpcUrls: [
      "https://rpc.testnet.xrplevm.org",
      "https://json-rpc.xrpl.cumulo.com.es",
      "https://xrplevm-testnet-evm.itrocket.net",
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

// ── Tier offsets ────────────────────────────────────────
const TIER_OFFSETS: Record<string, number> = {
  ONE_DAY: 24 * 60 * 60 * 1000,
  SIX_HOURS: 6 * 60 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  FIFTEEN_MINUTES: 15 * 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
};

// ── Block estimator ─────────────────────────────────────

async function fetchBlockHeightFromEthRpc(rpcUrl: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return parseInt(data.result, 16);
}

async function fetchBlockTimestampFromEthRpc(rpcUrl: string, blockNumber: number): Promise<number> {
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

async function fetchBlockTimeFromTendermint(
  tendermintUrl: string,
  sampleSize = 200
): Promise<{ avgBlockTimeMs: number; latestHeight: number }> {
  const statusRes = await fetch(`${tendermintUrl}/status`);
  const statusData = await statusRes.json();
  const latestHeight = parseInt(statusData.result.sync_info.latest_block_height, 10);
  const latestTime = new Date(statusData.result.sync_info.latest_block_time).getTime();

  const earlierHeight = Math.max(1, latestHeight - sampleSize);
  const blockRes = await fetch(`${tendermintUrl}/block?height=${earlierHeight}`);
  const blockData = await blockRes.json();
  const earlierTime = new Date(blockData.result.block.header.time).getTime();

  return {
    avgBlockTimeMs: (latestTime - earlierTime) / (latestHeight - earlierHeight),
    latestHeight,
  };
}

async function fetchBlockHeightFromCosmosApi(
  apiUrl: string
): Promise<{ height: number; time: string }> {
  const res = await fetch(`${apiUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`);
  const data = await res.json();
  return { height: parseInt(data.block.header.height, 10), time: data.block.header.time };
}

async function fetchBlockFromCosmosApi(
  apiUrl: string,
  height: number
): Promise<{ height: number; time: string }> {
  const res = await fetch(`${apiUrl}/cosmos/base/tendermint/v1beta1/blocks/${height}`);
  const data = await res.json();
  return { height: parseInt(data.block.header.height, 10), time: data.block.header.time };
}

async function tryMultiple<T>(urls: string[], fn: (url: string) => Promise<T>): Promise<{ result: T; url: string }> {
  const errors: Error[] = [];
  for (const url of urls) {
    try {
      return { result: await fn(url), url };
    } catch (e) {
      errors.push(e as Error);
    }
  }
  throw new Error(`All endpoints failed: ${errors.map((e) => e.message).join(", ")}`);
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

function average(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

interface BlockEstimate {
  currentBlock: number;
  targetBlock: number;
  blocksRemaining: number;
  avgBlockTimeMs: number;
  estimatedDate: Date;
}

async function estimateBlockTime(network: Network, targetBlock: number): Promise<BlockEstimate> {
  const config = NETWORKS[network];

  const [ethResult, tendermintResult, cosmosResult] = await Promise.allSettled([
    (async () => {
      const { result: height, url } = await tryMultiple(config.rpcUrls, fetchBlockHeightFromEthRpc);
      const sampleSize = 100;
      const earlierBlock = Math.max(0, height - sampleSize);
      const [latestTs, earlierTs] = await Promise.all([
        fetchBlockTimestampFromEthRpc(url, height),
        fetchBlockTimestampFromEthRpc(url, earlierBlock),
      ]);
      return { height, avgBlockTimeMs: ((latestTs - earlierTs) * 1000) / (height - earlierBlock), url };
    })(),
    (async () => {
      const { result, url } = await tryMultiple(config.tendermintRpcUrls, (u) => fetchBlockTimeFromTendermint(u, 200));
      return { ...result, url };
    })(),
    (async () => {
      const { result: latest, url } = await tryMultiple(config.cosmosApiUrls, fetchBlockHeightFromCosmosApi);
      const sampleSize = 100;
      const earlierHeight = Math.max(1, latest.height - sampleSize);
      const earlier = await fetchBlockFromCosmosApi(url, earlierHeight);
      const timeDiffMs = new Date(latest.time).getTime() - new Date(earlier.time).getTime();
      return { height: latest.height, avgBlockTimeMs: timeDiffMs / (latest.height - earlierHeight), url };
    })(),
  ]);

  const heights: number[] = [];
  const blockTimes: number[] = [];

  if (ethResult.status === "fulfilled") {
    heights.push(ethResult.value.height);
    blockTimes.push(ethResult.value.avgBlockTimeMs);
  }
  if (tendermintResult.status === "fulfilled") {
    heights.push(tendermintResult.value.latestHeight);
    blockTimes.push(tendermintResult.value.avgBlockTimeMs);
  }
  if (cosmosResult.status === "fulfilled") {
    heights.push(cosmosResult.value.height);
    blockTimes.push(cosmosResult.value.avgBlockTimeMs);
  }

  if (heights.length === 0) throw new Error("All data sources failed.");

  const currentBlock = median(heights);
  const avgBlockTimeMs = average(blockTimes);
  const blocksRemaining = targetBlock - currentBlock;

  if (blocksRemaining <= 0) {
    throw new Error(`Target block ${targetBlock} has already been reached. Current block is ${currentBlock}.`);
  }

  return {
    currentBlock,
    targetBlock,
    blocksRemaining,
    avgBlockTimeMs,
    estimatedDate: new Date(Date.now() + blocksRemaining * avgBlockTimeMs),
  };
}

// ── Calendar links ──────────────────────────────────────

function generateGoogleCalendarLink(params: {
  title: string;
  description: string;
  startDate: Date;
}): string {
  const endDate = new Date(params.startDate.getTime() + 30 * 60000);
  const fmt = (d: Date) => format(d, "yyyyMMdd'T'HHmmss'Z'");
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", params.title);
  url.searchParams.set("details", params.description);
  url.searchParams.set("dates", `${fmt(params.startDate)}/${fmt(endDate)}`);
  return url.toString();
}

function generateOutlookCalendarLink(params: {
  title: string;
  description: string;
  startDate: Date;
}): string {
  const endDate = new Date(params.startDate.getTime() + 30 * 60000);
  const url = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  url.searchParams.set("subject", params.title);
  url.searchParams.set("body", params.description);
  url.searchParams.set("startdt", params.startDate.toISOString());
  url.searchParams.set("enddt", endDate.toISOString());
  url.searchParams.set("path", "/calendar/action/compose");
  url.searchParams.set("rru", "addevent");
  return url.toString();
}

function buildCalendarLinks(params: {
  targetBlock: number;
  network: Network;
  estimatedDate: Date;
  blockWatchId: string;
  baseUrl: string;
}): { google: string; outlook: string; icsUrl: string } {
  const networkName = params.network === "XRPL_EVM_MAINNET" ? "XRPL EVM Mainnet" : "XRPL EVM Testnet";
  const title = `Block ${params.targetBlock.toLocaleString()} — ${networkName}`;
  const description = `Target block ${params.targetBlock} on ${networkName} is expected to be reached at this time.\n\nTrack: ${params.baseUrl}`;
  return {
    google: generateGoogleCalendarLink({ title, description, startDate: params.estimatedDate }),
    outlook: generateOutlookCalendarLink({ title, description, startDate: params.estimatedDate }),
    icsUrl: `${params.baseUrl}/api/calendar/${params.blockWatchId}`,
  };
}

// ── Slack ───────────────────────────────────────────────

function formatTier(tier: string): string {
  const map: Record<string, string> = {
    ONE_DAY: "1 day",
    SIX_HOURS: "6 hours",
    ONE_HOUR: "1 hour",
    FIFTEEN_MINUTES: "15 minutes",
    FIVE_MINUTES: "5 minutes",
    REACHED: "now",
  };
  return map[tier] ?? tier;
}

interface SlackNotificationPayload {
  blockWatchId: string;
  targetBlock: number;
  network: Network;
  estimatedDate: Date;
  currentBlock: number;
  blocksRemaining: number;
  tier: string;
  calendarLinks: { google: string; outlook: string; icsUrl: string };
}

async function sendSlackNotification(webhookUrl: string, payload: SlackNotificationPayload): Promise<void> {
  const networkName = payload.network === "XRPL_EVM_MAINNET" ? "XRPL EVM Mainnet" : "XRPL EVM Testnet";

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text:
          payload.tier === "REACHED"
            ? `✅ Block ${payload.targetBlock.toLocaleString()} has been reached!`
            : `⏰ Block ${payload.targetBlock.toLocaleString()} — ${formatTier(payload.tier)} away!`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Network:*\n${networkName}` },
        { type: "mrkdwn", text: `*Target Block:*\n${payload.targetBlock.toLocaleString()}` },
        { type: "mrkdwn", text: `*Current Block:*\n${payload.currentBlock.toLocaleString()}` },
        { type: "mrkdwn", text: `*Blocks Remaining:*\n${payload.blocksRemaining.toLocaleString()}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Estimated Time:* ${payload.estimatedDate.toUTCString()}` },
    },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: "📅 Google Calendar" }, url: payload.calendarLinks.google, style: "primary" },
        { type: "button", text: { type: "plain_text", text: "📅 Outlook Calendar" }, url: payload.calendarLinks.outlook },
        { type: "button", text: { type: "plain_text", text: "📥 Download .ics" }, url: payload.calendarLinks.icsUrl },
      ],
    },
  ];

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
}

// ── Main ────────────────────────────────────────────────

async function processNotifications(): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://block-to-time.vercel.app";

  const pendingNotifications = await prisma.notification.findMany({
    where: {
      sent: false,
      scheduledFor: { lte: new Date() },
    },
    include: { blockWatch: true },
    take: 50,
  });

  if (pendingNotifications.length === 0) {
    console.log("No pending notifications.");
    return;
  }

  console.log(`Processing ${pendingNotifications.length} pending notification(s)...`);

  for (const notification of pendingNotifications) {
    const bw = notification.blockWatch;

    try {
      let estimate: BlockEstimate | undefined;
      let blockReached = false;

      try {
        estimate = await estimateBlockTime(bw.network as Network, Number(bw.targetBlock));
      } catch (err) {
        if (err instanceof Error && err.message.includes("already been reached")) {
          blockReached = true;
        } else {
          throw err;
        }
      }

      if (blockReached) {
        if (bw.slackWebhookUrl) {
          const calendarLinks = buildCalendarLinks({
            targetBlock: Number(bw.targetBlock),
            network: bw.network as Network,
            estimatedDate: new Date(),
            blockWatchId: bw.id,
            baseUrl,
          });
          await sendSlackNotification(bw.slackWebhookUrl, {
            blockWatchId: bw.id,
            targetBlock: Number(bw.targetBlock),
            network: bw.network as Network,
            estimatedDate: new Date(),
            currentBlock: Number(bw.targetBlock),
            blocksRemaining: 0,
            tier: "REACHED",
            calendarLinks,
          });
        }

        await prisma.notification.updateMany({
          where: { blockWatchId: bw.id, sent: false },
          data: { sent: true, sentAt: new Date() },
        });

        console.log(`  ✅ [${notification.id}] ${notification.tier} → block reached`);
        continue;
      }

      // Update block watch with latest estimate
      await prisma.blockWatch.update({
        where: { id: bw.id },
        data: {
          currentBlock: BigInt(estimate!.currentBlock),
          estimatedTime: estimate!.estimatedDate,
        },
      });

      // Reschedule future notifications
      const allTiers = Object.keys(TIER_OFFSETS) as NotificationTier[];
      for (const tier of allTiers) {
        const newScheduledFor = new Date(estimate!.estimatedDate.getTime() - TIER_OFFSETS[tier]);
        if (newScheduledFor.getTime() > Date.now()) {
          await prisma.notification.updateMany({
            where: { blockWatchId: bw.id, tier, sent: false },
            data: { scheduledFor: newScheduledFor },
          });
        }
      }

      // Send Slack notification
      if (bw.slackWebhookUrl) {
        const calendarLinks = buildCalendarLinks({
          targetBlock: Number(bw.targetBlock),
          network: bw.network as Network,
          estimatedDate: estimate!.estimatedDate,
          blockWatchId: bw.id,
          baseUrl,
        });
        await sendSlackNotification(bw.slackWebhookUrl, {
          blockWatchId: bw.id,
          targetBlock: Number(bw.targetBlock),
          network: bw.network as Network,
          estimatedDate: estimate!.estimatedDate,
          currentBlock: estimate!.currentBlock,
          blocksRemaining: estimate!.blocksRemaining,
          tier: notification.tier,
          calendarLinks,
        });
      }

      // Mark as sent
      await prisma.notification.update({
        where: { id: notification.id },
        data: { sent: true, sentAt: new Date() },
      });

      console.log(`  ✅ [${notification.id}] ${notification.tier} → sent`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`  ❌ [${notification.id}] ${notification.tier} → ${message}`);
    }
  }
}

// ── Entry point — persistent loop every 60 s ───────────
const INTERVAL_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  console.log(`[${new Date().toISOString()}] Cron notify service started (interval: ${INTERVAL_MS / 1000}s)`);

  // Handle graceful shutdown
  let running = true;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      console.log(`Received ${sig}, shutting down...`);
      running = false;
    });
  }

  while (running) {
    try {
      console.log(`\n[${new Date().toISOString()}] Processing notifications...`);
      await processNotifications();
    } catch (err) {
      console.error("Error in notification cycle:", err);
    }
    await sleep(INTERVAL_MS);
  }

  await prisma.$disconnect();
  console.log("Cron service stopped.");
})();
