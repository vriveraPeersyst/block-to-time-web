import { NextRequest, NextResponse } from "next/server";
import { estimateBlockTime } from "@/lib/block-estimator";
import type { Network } from "@/lib/networks";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const block = searchParams.get("block");
  const network = searchParams.get("network") as Network | null;

  if (!block || isNaN(Number(block)) || Number(block) <= 0) {
    return NextResponse.json(
      { error: "Invalid block number. Must be a positive integer." },
      { status: 400 }
    );
  }

  if (!network || !["XRPL_EVM_MAINNET", "XRPL_EVM_TESTNET"].includes(network)) {
    return NextResponse.json(
      { error: "Invalid network. Must be XRPL_EVM_MAINNET or XRPL_EVM_TESTNET." },
      { status: 400 }
    );
  }

  try {
    const estimate = await estimateBlockTime(network, Number(block));
    return NextResponse.json(estimate);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
