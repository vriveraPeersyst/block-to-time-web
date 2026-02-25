import type { Network } from "./networks";
import {
  generateGoogleCalendarLink,
  generateOutlookCalendarLink,
} from "./calendar";

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text?: { type: string; text: string }; url?: string; style?: string }>;
  fields?: Array<{ type: string; text: string }>;
}

export interface SlackNotificationPayload {
  blockWatchId: string;
  targetBlock: number;
  network: Network;
  estimatedDate: Date;
  currentBlock: number;
  blocksRemaining: number;
  tier: string;
  calendarLinks: {
    google: string;
    outlook: string;
    icsUrl: string;
  };
}

function formatTier(tier: string): string {
  const map: Record<string, string> = {
    ONE_DAY: "1 day",
    SIX_HOURS: "6 hours",
    ONE_HOUR: "1 hour",
    FIFTEEN_MINUTES: "15 minutes",
    FIVE_MINUTES: "5 minutes",
  };
  return map[tier] ?? tier;
}

/**
 * Send a notification to a Slack webhook
 */
export async function sendSlackNotification(
  webhookUrl: string,
  payload: SlackNotificationPayload
): Promise<void> {
  const networkName =
    payload.network === "XRPL_EVM_MAINNET"
      ? "XRPL EVM Mainnet"
      : "XRPL EVM Testnet";

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `⏰ Block ${payload.targetBlock.toLocaleString()} — ${formatTier(payload.tier)} away!`,
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Network:*\n${networkName}`,
        },
        {
          type: "mrkdwn",
          text: `*Target Block:*\n${payload.targetBlock.toLocaleString()}`,
        },
        {
          type: "mrkdwn",
          text: `*Current Block:*\n${payload.currentBlock.toLocaleString()}`,
        },
        {
          type: "mrkdwn",
          text: `*Blocks Remaining:*\n${payload.blocksRemaining.toLocaleString()}`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Estimated Time:* ${payload.estimatedDate.toUTCString()}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "📅 Google Calendar" },
          url: payload.calendarLinks.google,
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📅 Outlook Calendar" },
          url: payload.calendarLinks.outlook,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "📥 Download .ics" },
          url: payload.calendarLinks.icsUrl,
        },
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

/**
 * Build calendar links for a notification
 */
export function buildCalendarLinks(params: {
  targetBlock: number;
  network: Network;
  estimatedDate: Date;
  blockWatchId: string;
  baseUrl: string;
}): { google: string; outlook: string; icsUrl: string } {
  const networkName =
    params.network === "XRPL_EVM_MAINNET"
      ? "XRPL EVM Mainnet"
      : "XRPL EVM Testnet";

  const title = `Block ${params.targetBlock.toLocaleString()} — ${networkName}`;
  const description = `Target block ${params.targetBlock} on ${networkName} is expected to be reached at this time.\n\nTrack: ${params.baseUrl}`;

  return {
    google: generateGoogleCalendarLink({
      title,
      description,
      startDate: params.estimatedDate,
    }),
    outlook: generateOutlookCalendarLink({
      title,
      description,
      startDate: params.estimatedDate,
    }),
    icsUrl: `${params.baseUrl}/api/calendar/${params.blockWatchId}`,
  };
}
