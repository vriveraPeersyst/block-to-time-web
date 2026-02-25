import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateICSContent } from "@/lib/calendar";
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
  });

  if (!blockWatch) {
    return NextResponse.json(
      { error: "Block watch not found" },
      { status: 404 }
    );
  }

  const networkName =
    blockWatch.network === "XRPL_EVM_MAINNET"
      ? "XRPL EVM Mainnet"
      : "XRPL EVM Testnet";

  const icsContent = generateICSContent({
    title: `Block ${blockWatch.targetBlock.toString()} — ${networkName}`,
    description: `Target block ${blockWatch.targetBlock.toString()} on ${networkName} is expected to be reached at this time.`,
    startDate: blockWatch.estimatedTime,
    uid: blockWatch.id,
  });

  return new NextResponse(icsContent, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="block-${blockWatch.targetBlock}.ics"`,
    },
  });
}
