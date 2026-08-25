import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { isOwnerEmail } from "../../../../lib/access";
import { queueUsageForToday } from "../../../../lib/queue-quota";
import { platformSettings } from "../../../../db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user || !isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  const db = getDb(), settings = await db.select({ budget: platformSettings.queueDailyOperationBudget }).from(platformSettings).where(eq(platformSettings.id, "global")).limit(1).then(rows => rows[0]);
  return NextResponse.json(await queueUsageForToday(db, Math.max(1000, Math.min(10000, settings?.budget ?? 7500))));
}
