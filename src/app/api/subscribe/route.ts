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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
