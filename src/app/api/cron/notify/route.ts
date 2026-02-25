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
    const results: Array<{ id: string; tier: string; status: string; note?: string; error?: string }> = [];

    // ── Pass 1: Process pending tier notifications ────────
    const pendingNotifications = await prisma.notification.findMany({
      where: {
        sent: false,
        scheduledFor: { lte: new Date() },
      },
      include: {
        blockWatch: true,
      },
      take: 50,
    });

    for (const notification of pendingNotifications) {
      const bw = notification.blockWatch;

      try {
        let estimate;
        let blockReached = false;

        try {
          estimate = await estimateBlockTime(
            bw.network as Network,
            Number(bw.targetBlock)
          );
        } catch (err) {
          if (err instanceof Error && err.message.includes("already been reached")) {
            blockReached = true;
          } else {
            throw err;
          }
        }

        if (blockReached) {
          if (bw.slackWebhookUrl && !bw.reachedNotifiedAt) {
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
          await prisma.blockWatch.update({
            where: { id: bw.id },
            data: { reachedNotifiedAt: new Date() },
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

        const calendarLinks = buildCalendarLinks({
          targetBlock: Number(bw.targetBlock),
          network: bw.network as Network,
          estimatedDate: estimate!.estimatedDate,
          blockWatchId: bw.id,
          baseUrl,
        });

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

    // ── Pass 2: Check for reached blocks (all tiers sent but no REACHED notification) ──
    const unreachedWatches = await prisma.blockWatch.findMany({
      where: {
        reachedNotifiedAt: null,
        slackWebhookUrl: { not: null },
        notifications: { every: { sent: true } },
      },
      take: 20,
    });

    for (const bw of unreachedWatches) {
      try {
        let blockReached = false;

        try {
          await estimateBlockTime(bw.network as Network, Number(bw.targetBlock));
        } catch (err) {
          if (err instanceof Error && err.message.includes("already been reached")) {
            blockReached = true;
          }
        }

        if (!blockReached) continue;

        const calendarLinks = buildCalendarLinks({
          targetBlock: Number(bw.targetBlock),
          network: bw.network as Network,
          estimatedDate: new Date(),
          blockWatchId: bw.id,
          baseUrl,
        });

        await sendSlackNotification(bw.slackWebhookUrl!, {
          blockWatchId: bw.id,
          targetBlock: Number(bw.targetBlock),
          network: bw.network as Network,
          estimatedDate: new Date(),
          currentBlock: Number(bw.targetBlock),
          blocksRemaining: 0,
          tier: "REACHED",
          calendarLinks,
        });

        await prisma.blockWatch.update({
          where: { id: bw.id },
          data: { reachedNotifiedAt: new Date() },
        });

        results.push({
          id: bw.id,
          tier: "REACHED",
          status: "sent",
          note: "block reached — final notification",
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        results.push({
          id: bw.id,
          tier: "REACHED",
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
