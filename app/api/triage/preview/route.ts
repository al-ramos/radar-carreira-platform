import { and, count, eq, gte, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, profiles } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { hasCurrentTriage, hasTriageableDescription } from "../../../../lib/current-triage";

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
  if (!sourceId) return NextResponse.json({ count: 0 });
  if (ingestionChannel && !channels.has(ingestionChannel)) return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  if (!["24", "72", "168", "all"].includes(homePeriod)) return NextResponse.json({ error: "Período inválido" }, { status: 400 });

  const db = getDb();
  const profile = await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de consultar a triagem." }, { status: 412 });
  const versions = getAnalysisVersions(canonicalizeProfile(profile));
  const currentTriage = hasCurrentTriage(user.userId, versions);
  const descriptionReady = hasTriageableDescription();
  const cutoff = homePeriod === "all" ? null : new Date(Date.now() - Number(homePeriod) * 36e5);
  const [result] = await getDb()
    .select({
      total: count(),
      triaged: sql<number>`sum(case when ${currentTriage} then 1 else 0 end)`,
      missingDescription: sql<number>`sum(case when not (${descriptionReady}) then 1 else 0 end)`,
      actionable: sql<number>`sum(case when ${descriptionReady} and (${includeTriaged} or not (${currentTriage})) then 1 else 0 end)`,
    })
    .from(jobs)
    .where(and(
      eq(jobs.status, "active"),
      sourceId === "all" ? undefined : eq(jobs.sourceId, sourceId),
      cutoff ? gte(jobs.firstSeenAt, cutoff) : undefined,
      roleArea && roleArea !== "all" ? eq(jobs.roleArea, roleArea) : undefined,
      ingestionChannel ? eq(jobs.ingestionChannel, ingestionChannel as "extension" | "email" | "connector" | "file" | "api") : undefined,
    ));

  const total = Number(result?.total ?? 0);
  const triaged = Number(result?.triaged ?? 0);
  const missingDescription = Number(result?.missingDescription ?? 0);
  const actionable = Number(result?.actionable ?? 0);
  return NextResponse.json({ count: actionable, total, triaged, missingDescription });
}
