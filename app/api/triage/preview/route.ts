import { and, count, eq, gte } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";

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
  const homePeriod = searchParams.get("period") ?? "24";
  if (!sourceId || sourceId === "all") return NextResponse.json({ count: 0 });
  if (ingestionChannel && !channels.has(ingestionChannel)) return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  if (!["24", "72", "168", "all"].includes(homePeriod)) return NextResponse.json({ error: "Período inválido" }, { status: 400 });

  const cutoff = homePeriod === "all" ? null : new Date(Date.now() - Number(homePeriod) * 36e5);
  const [result] = await getDb()
    .select({ total: count(), triaged: count(userJobAnalyses.jobId) })
    .from(jobs)
    .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, jobs.id)))
    .where(and(
      eq(jobs.status, "active"),
      eq(jobs.sourceId, sourceId),
      cutoff ? gte(jobs.firstSeenAt, cutoff) : undefined,
      roleArea && roleArea !== "all" ? eq(jobs.roleArea, roleArea) : undefined,
      ingestionChannel ? eq(jobs.ingestionChannel, ingestionChannel as "extension" | "email" | "connector" | "file" | "api") : undefined,
    ));

  const total = Number(result?.total ?? 0);
  const triaged = Number(result?.triaged ?? 0);
  return NextResponse.json({ count: includeTriaged ? total : total - triaged, total, triaged });
}
