import { and, count, eq, gte, isNull, lt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { saoPauloDayWindow } from "../../../../lib/triage-orchestrator";

export const dynamic = "force-dynamic";

const channels = new Set(["extension", "email", "connector", "file", "api"]);

export async function GET(request: NextRequest) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });

  const { searchParams } = request.nextUrl;
  const sourceId = searchParams.get("sourceId")?.trim();
  const roleArea = searchParams.get("roleArea")?.trim();
  const ingestionChannel = searchParams.get("ingestionChannel")?.trim();
  const includeTriaged = searchParams.get("includeTriaged") === "true";
  if (!sourceId || sourceId === "all") return NextResponse.json({ count: 0 });
  if (ingestionChannel && !channels.has(ingestionChannel)) return NextResponse.json({ error: "Canal inválido" }, { status: 400 });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const window = saoPauloDayWindow(today);
  const [result] = await getDb()
    .select({ count: count() })
    .from(jobs)
    .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, jobs.id)))
    .where(and(
      eq(jobs.status, "active"),
      eq(jobs.sourceId, sourceId),
      gte(jobs.firstSeenAt, window.start),
      lt(jobs.firstSeenAt, window.end),
      roleArea && roleArea !== "all" ? eq(jobs.roleArea, roleArea) : undefined,
      ingestionChannel ? eq(jobs.ingestionChannel, ingestionChannel as "extension" | "email" | "connector" | "file" | "api") : undefined,
      includeTriaged ? undefined : isNull(userJobAnalyses.jobId),
    ));

  return NextResponse.json({ count: Number(result?.count ?? 0) });
}
