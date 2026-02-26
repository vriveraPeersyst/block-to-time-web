import { NextRequest, NextResponse } from "next/server";
import { estimateBlockAtTime } from "@/lib/block-estimator";
import type { Network } from "@/lib/networks";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const time = searchParams.get("time");
  const network = searchParams.get("network") as Network | null;
  const blockTimeParam = searchParams.get("blockTime");

  if (!time) {
    return NextResponse.json(
      { error: "Missing 'time' parameter. Provide an ISO 8601 date string." },
      { status: 400 }
    );
  }

  const targetDate = new Date(time);
  if (isNaN(targetDate.getTime())) {
    return NextResponse.json(
      { error: "Invalid date format. Provide an ISO 8601 date string." },
      { status: 400 }
    );
  }

  if (!network || !["XRPL_EVM_MAINNET", "XRPL_EVM_TESTNET"].includes(network)) {
    return NextResponse.json(
      { error: "Invalid network. Must be XRPL_EVM_MAINNET or XRPL_EVM_TESTNET." },
      { status: 400 }
    );
  }

  let customBlockTimeMs: number | undefined;
  if (blockTimeParam) {
    const parsed = parseFloat(blockTimeParam);
    if (isNaN(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: "Invalid blockTime. Must be a positive number in seconds." },
        { status: 400 }
      );
    }
    customBlockTimeMs = parsed * 1000;
  }

  try {
    const estimate = await estimateBlockAtTime(network, targetDate, customBlockTimeMs);
    return NextResponse.json({
      ...estimate,
      targetDate: estimate.targetDate.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
