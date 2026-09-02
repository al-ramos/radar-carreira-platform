import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobs, profiles, triageBatchItems, triageHistory, userJobAnalyses } from "../../../../../db/schema";
import { isOwnerEmail } from "../../../../../lib/access";
import { canonicalizeProfile } from "../../../../../lib/canonical-profile";
import { getAnalysisVersions } from "../../../../../lib/analysis-versions";
import { hasTriageableDescription } from "../../../../../lib/current-triage";

/**
 * Recupera somente avaliações já concluídas e registradas no histórico que,
 * por uma versão anterior do fluxo de idempotência, não chegaram à tabela que
 * alimenta a tela de resultados. Não reprocessa vagas nem cria rascunhos.
 */
export async function POST() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });

  const db = getDb();
  const profile = await db.select().from(profiles)
    .where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0]);
  if (!profile) return NextResponse.json({ error: "Perfil técnico não encontrado" }, { status: 412 });
  const versions = getAnalysisVersions(canonicalizeProfile(profile));

  const missingRows = await db.select({
    id: triageHistory.id, jobId: triageHistory.jobId,
    profileRevision: triageHistory.profileRevision, rulesRevision: triageHistory.rulesRevision, instructionsRevision: triageHistory.instructionsRevision,
    verdict: triageHistory.verdict, label: triageHistory.label, blocker: triageHistory.blocker, rows: triageHistory.rows,
    source: triageHistory.source, confidence: triageHistory.confidence, createdAt: triageHistory.createdAt,
  }).from(triageHistory)
    .innerJoin(jobs, eq(triageHistory.jobId, jobs.id))
    .innerJoin(triageBatchItems, and(
      eq(triageBatchItems.batchId, triageHistory.batchId),
      eq(triageBatchItems.jobId, triageHistory.jobId),
      eq(triageBatchItems.status, "completed"),
    ))
    .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, triageHistory.jobId)))
    .where(and(
      eq(triageHistory.userId, user.userId),
      eq(triageHistory.profileRevision, versions.profileRevision),
      eq(triageHistory.rulesRevision, versions.rulesRevision),
      eq(triageHistory.instructionsRevision, versions.instructionsRevision),
      gte(triageHistory.createdAt, jobs.triageInputUpdatedAt),
      hasTriageableDescription(),
      isNull(userJobAnalyses.jobId),
    ))
    .orderBy(desc(triageHistory.createdAt));

  // Há histórico aditivo (regras e, às vezes, refinamento por IA) para a mesma
  // vaga. Restaura apenas a avaliação final mais recente de cada uma.
  const latestByJob = new Map<string, typeof missingRows[number]>();
  for (const row of missingRows) {
    const current = latestByJob.get(row.jobId);
    if (!current || row.createdAt > current.createdAt || (row.createdAt.getTime() === current.createdAt.getTime() && row.source === "ai" && current.source !== "ai")) latestByJob.set(row.jobId, row);
  }
  const recoveredAt = new Date();
  let recovered = 0;
  for (const row of latestByJob.values()) {
    const inserted = await db.insert(userJobAnalyses).values({
      userId: user.userId, jobId: row.jobId, profileVersion: profile.updatedAt,
      profileRevision: row.profileRevision, rulesRevision: row.rulesRevision, instructionsRevision: row.instructionsRevision,
      verdict: row.verdict, label: row.label, blocker: row.blocker, rows: row.rows,
      matchingSkills: "[]", missingSkills: "[]", source: row.source, confidence: row.confidence,
      explanation: JSON.stringify({ recoveredFromTriageHistoryId: row.id }), createdAt: recoveredAt, updatedAt: recoveredAt,
    }).onConflictDoNothing().returning({ jobId: userJobAnalyses.jobId });
    recovered += inserted.length;
  }

  return NextResponse.json({ recovered, found: latestByJob.size });
}
