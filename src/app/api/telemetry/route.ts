import { NextRequest, NextResponse } from "next/server";
import {
  fetchLiveProtocolTelemetry,
  inspectOnChainPosition,
} from "@/lib/indexer";
import type { NetworkKey } from "@/lib/chains";

export const dynamic = "force-dynamic";

function parseBoundedTokenId(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.max(1, Math.min(1_000_000, parsed));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const networkParam = searchParams.get("network");
    const network: NetworkKey =
      networkParam === "testnet" ? "testnet" : "mainnet";
    const includeFloor = searchParams.get("floor") !== "false";

    const defaultMezoId = network === "testnet" ? 682 : 148;
    const defaultBtcId = network === "testnet" ? 8 : 98;
    const veMezoId = parseBoundedTokenId(
      searchParams.get("veMezoId"),
      defaultMezoId
    );
    const veBtcId = parseBoundedTokenId(
      searchParams.get("veBtcId"),
      defaultBtcId
    );

    const [telemetry, position] = await Promise.all([
      fetchLiveProtocolTelemetry(network, includeFloor),
      inspectOnChainPosition(network, veMezoId, veBtcId),
    ]);

    return NextResponse.json({
      ok: true,
      telemetry,
      position,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to query Mezo RPC";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
