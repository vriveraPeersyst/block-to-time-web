import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserId } from "@/lib/api-auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthenticatedUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const blockWatch = await prisma.blockWatch.findUnique({
    where: { id, userId },
    include: { notifications: { orderBy: { scheduledFor: "asc" } } },
  });

  if (!blockWatch) {
    return NextResponse.json(
      { error: "Block watch not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    id: blockWatch.id,
    targetBlock: Number(blockWatch.targetBlock),
    currentBlock: Number(blockWatch.currentBlock),
    network: blockWatch.network,
    estimatedTime: blockWatch.estimatedTime.toISOString(),
    timezone: blockWatch.timezone,
    slackWebhookUrl: blockWatch.slackWebhookUrl ? "configured" : null,
    createdAt: blockWatch.createdAt.toISOString(),
    notifications: blockWatch.notifications.map((n) => ({
      tier: n.tier,
      scheduledFor: n.scheduledFor.toISOString(),
      sent: n.sent,
      sentAt: n.sentAt?.toISOString() ?? null,
    })),
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getAuthenticatedUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;

  const blockWatch = await prisma.blockWatch.findUnique({
    where: { id, userId },
  });

  if (!blockWatch) {
    return NextResponse.json(
      { error: "Block watch not found" },
      { status: 404 }
    );
  }

  await prisma.blockWatch.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
