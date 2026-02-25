import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId } from "@/lib/api-auth";

/**
 * GET /api/watches — list the authenticated user's block watches
 */
export async function GET() {
  const userId = await getAuthenticatedUserId();
  if (userId instanceof NextResponse) return userId;

  const watches = await prisma.blockWatch.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      notifications: { orderBy: { scheduledFor: "asc" } },
    },
  });

  return NextResponse.json(
    watches.map((w) => ({
      id: w.id,
      targetBlock: Number(w.targetBlock),
      currentBlock: Number(w.currentBlock),
      network: w.network,
      estimatedTime: w.estimatedTime.toISOString(),
      timezone: w.timezone,
      slackWebhookUrl: w.slackWebhookUrl
        ? `...${w.slackWebhookUrl.slice(-8)}`
        : null,
      createdAt: w.createdAt.toISOString(),
      notifications: w.notifications.map((n) => ({
        tier: n.tier,
        scheduledFor: n.scheduledFor.toISOString(),
        sent: n.sent,
      })),
    }))
  );
}
