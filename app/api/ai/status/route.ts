import { and, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { aiUsageEvents, profiles } from "../../../../db/schema";
import { getAiProviderStatus } from "../../../../lib/ai-provider";
import { normalizeCareerRules } from "../../../../lib/profile-options";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const db = getDb();
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const [profile, events] = await Promise.all([
    db.select({ careerRules: profiles.careerRules }).from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then(rows => rows[0]),
    db.select({ inputTokens: aiUsageEvents.inputTokens, outputTokens: aiUsageEvents.outputTokens }).from(aiUsageEvents).where(and(eq(aiUsageEvents.userId, user.userId), gte(aiUsageEvents.createdAt, monthStart))),
  ]);
  const usedTokens = events.reduce((total, event) => total + event.inputTokens + event.outputTokens, 0);
  const limit = normalizeCareerRules(profile?.careerRules).aiMonthlyTokenLimit;
  return NextResponse.json({ provider: getAiProviderStatus(), usage: { usedTokens, limit, remainingTokens: Math.max(0, limit - usedTokens), period: monthStart.toISOString().slice(0, 7) } });
}
