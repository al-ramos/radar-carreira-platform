import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { isOwnerEmail } from "../../../../lib/access";
import { queueUsageForToday } from "../../../../lib/queue-quota";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user || !isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  return NextResponse.json(await queueUsageForToday(getDb()));
}
