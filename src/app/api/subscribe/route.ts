import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { estimateBlockTime } from "@/lib/block-estimator";
import type { Network } from "@/lib/networks";
import { NotificationTier } from "@prisma/client";
import { getAuthenticatedUserId } from "@/lib/api-auth";

const TIER_OFFSETS: Record<NotificationTier, number> = {
  ONE_DAY: 24 * 60 * 60 * 1000,
  SIX_HOURS: 6 * 60 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  FIFTEEN_MINUTES: 15 * 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
};

const ALLOWED_NETWORKS: Network[] = ["XRPL_EVM_MAINNET", "XRPL_EVM_TESTNET"];
// Slack incoming webhook URLs always match this prefix
const SLACK_WEBHOOK_REGEX = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;
const MAX_TARGET_BLOCK = 1_000_000_000;
const MAX_TITLE_LENGTH = 200;
const MAX_TIMEZONE_LENGTH = 64;

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (userId instanceof NextResponse) return userId;

    const body = await request.json();
    const {
      targetBlock,
      network,
      timezone,
      slackWebhookUrl,
      email,
      title,
    } = body as {
      targetBlock: number;
      network: Network;
      timezone?: string;
      slackWebhookUrl?: string;
      email?: string;
      title?: string;
    };

    if (!targetBlock || !network) {
      return NextResponse.json(
        { error: "targetBlock and network are required." },
        { status: 400 }
      );
    }

    if (
      typeof targetBlock !== "number" ||
      !Number.isInteger(targetBlock) ||
      targetBlock <= 0 ||
      targetBlock > MAX_TARGET_BLOCK
    ) {
      return NextResponse.json(
        { error: "targetBlock must be a positive integer." },
        { status: 400 }
      );
    }

    if (!ALLOWED_NETWORKS.includes(network)) {
      return NextResponse.json(
        { error: "Invalid network. Must be XRPL_EVM_MAINNET or XRPL_EVM_TESTNET." },
        { status: 400 }
      );
    }

    if (slackWebhookUrl && !SLACK_WEBHOOK_REGEX.test(slackWebhookUrl)) {
      return NextResponse.json(
        { error: "Invalid Slack webhook URL format." },
        { status: 400 }
      );
    }

    if (title !== undefined && (typeof title !== "string" || title.length > MAX_TITLE_LENGTH)) {
      return NextResponse.json(
        { error: `title must be at most ${MAX_TITLE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    if (timezone !== undefined && (typeof timezone !== "string" || timezone.length > MAX_TIMEZONE_LENGTH)) {
      return NextResponse.json(
        { error: "Invalid timezone." },
        { status: 400 }
      );
    }

    if (!slackWebhookUrl && !email) {
      return NextResponse.json(
        { error: "At least one notification method is required (slackWebhookUrl or email)." },
        { status: 400 }
      );
    }

    // Set a 10s timeout for the fetch
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let estimate;
    try {
      estimate = await estimateBlockTime(network, targetBlock);
    } finally {
      clearTimeout(timeout);
    }

    // Create the block watch with notifications
    const blockWatch = await prisma.blockWatch.create({
      data: {
        userId,
        targetBlock: BigInt(targetBlock),
        network,
        currentBlock: BigInt(estimate.currentBlock),
        estimatedTime: estimate.estimatedDate,
        timezone: timezone ?? "UTC",
        title: title ?? "",
        slackWebhookUrl: slackWebhookUrl ?? null,
        email: email ?? null,
        notifications: {
          create: Object.entries(TIER_OFFSETS)
            .filter(([, offsetMs]) => {
              // Only create notifications for tiers that are in the future
              const scheduledFor = new Date(
                estimate.estimatedDate.getTime() - offsetMs
              );
              return scheduledFor.getTime() > Date.now();
            })
            .map(([tier, offsetMs]) => ({
              tier: tier as NotificationTier,
              scheduledFor: new Date(
                estimate.estimatedDate.getTime() - offsetMs
              ),
            })),
        },
      },
      include: { notifications: true },
    });

    return NextResponse.json({
      id: blockWatch.id,
      targetBlock: Number(blockWatch.targetBlock),
      currentBlock: Number(blockWatch.currentBlock),
      network: blockWatch.network,
      estimatedTime: blockWatch.estimatedTime.toISOString(),
      timezone: blockWatch.timezone,
      notifications: blockWatch.notifications.map((n) => ({
        tier: n.tier,
        scheduledFor: n.scheduledFor.toISOString(),
        sent: n.sent,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Surface block-already-reached errors as 422 (expected domain errors)
    if (message.includes("already been reached")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    // For all other internal errors, return a generic message to avoid leaking details
    console.error("[subscribe] Internal error:", message);
    return NextResponse.json({ error: "Failed to create block watch. Please try again." }, { status: 500 });
  }
}
