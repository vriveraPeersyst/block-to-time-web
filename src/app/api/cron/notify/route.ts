import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { estimateBlockTime } from "@/lib/block-estimator";
import { sendSlackNotification, buildCalendarLinks } from "@/lib/slack";
import { NotificationTier } from "@prisma/client";
import type { Network } from "@/lib/networks";

const TIER_OFFSETS: Record<string, number> = {
  ONE_DAY: 24 * 60 * 60 * 1000,
  SIX_HOURS: 6 * 60 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  FIFTEEN_MINUTES: 15 * 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
};

/**
 * Cron endpoint - called periodically to process pending notifications
 * Vercel Crons use GET with CRON_SECRET; also supports POST for manual/external triggers.
 */
function verifyCronAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

async function processNotifications(): Promise<NextResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://blocktotime.app";

  try {
    // Find all notifications that are due and haven't been sent
    const pendingNotifications = await prisma.notification.findMany({
      where: {
        sent: false,
        scheduledFor: { lte: new Date() },
      },
      include: {
        blockWatch: true,
      },
      take: 50, // Process in batches
    });

    const results = [];

    for (const notification of pendingNotifications) {
      const bw = notification.blockWatch;

      try {
        let estimate;
        let blockReached = false;

        try {
          // Re-estimate the block time for fresh data
          estimate = await estimateBlockTime(
            bw.network as Network,
            Number(bw.targetBlock)
          );
        } catch (err) {
          // Block already reached — send a final notification
          if (err instanceof Error && err.message.includes("already been reached")) {
            blockReached = true;
          } else {
            throw err;
          }
        }

        if (blockReached) {
          // Send "block reached" notification and mark all as sent
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

          // Mark all unsent notifications as sent
          await prisma.notification.updateMany({
            where: { blockWatchId: bw.id, sent: false },
            data: { sent: true, sentAt: new Date() },
          });

          results.push({
            id: notification.id,
            tier: notification.tier,
            status: "sent",
            note: "block already reached",
          });
          continue;
        }

        // Update the block watch with latest estimate
        await prisma.blockWatch.update({
          where: { id: bw.id },
          data: {
            currentBlock: BigInt(estimate!.currentBlock),
            estimatedTime: estimate!.estimatedDate,
          },
        });

        // Update future notifications with new schedule
        const allTiers = Object.keys(TIER_OFFSETS) as NotificationTier[];
        for (const tier of allTiers) {
          const newScheduledFor = new Date(
            estimate!.estimatedDate.getTime() - TIER_OFFSETS[tier]
          );
          if (newScheduledFor.getTime() > Date.now()) {
            await prisma.notification.updateMany({
              where: {
                blockWatchId: bw.id,
                tier,
                sent: false,
              },
              data: { scheduledFor: newScheduledFor },
            });
          }
        }

        // Build calendar links with updated time
        const calendarLinks = buildCalendarLinks({
          targetBlock: Number(bw.targetBlock),
          network: bw.network as Network,
          estimatedDate: estimate!.estimatedDate,
          blockWatchId: bw.id,
          baseUrl,
        });

        // Send Slack notification if webhook is set
        if (bw.slackWebhookUrl) {
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

        results.push({
          id: notification.id,
          tier: notification.tier,
          status: "sent",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        results.push({
          id: notification.id,
          tier: notification.tier,
          status: "failed",
          error: message,
        });
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  return processNotifications();
}

export async function POST(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  return processNotifications();
}
