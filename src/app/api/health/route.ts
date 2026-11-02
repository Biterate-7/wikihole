import { NextResponse } from "next/server";
import { isAiEnabled } from "@/lib/ai/config";
import { rateLimitCooldownMs } from "@/lib/wikipedia/http";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      ai: isAiEnabled(),
      userAgentConfigured: Boolean(process.env.WIKIMEDIA_USER_AGENT?.trim()),
      wikipediaCooldownMs: rateLimitCooldownMs(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
