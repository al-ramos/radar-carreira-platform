import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, profiles, triageBatches, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";

export const dynamic = "force-dynamic";

type DisqualifyRequest = { jobId?: string; jobIds?: string[] };

/**
 * Registra uma decisão humana sem apagar avaliação ou rascunho já criado.
 * Antes, exigia uma avaliação existente (409 caso contrário) — o que
 * impedia desclassificar uma vaga recém-importada, ainda sem triagem. Agora
 * cria a avaliação quando ela não existe, usando as revisões atuais do
 * perfil; quando já existe, preserva as revisões e o "rows" originais, como
 * antes.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as DisqualifyRequest;
  const jobIds = [...new Set([body.jobId, ...(Array.isArray(body.jobIds) ? body.jobIds : [])].filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean))];
  if (!jobIds.length) return NextResponse.json({ error: "Informe ao menos uma vaga a desclassificar." }, { status: 400 });
  if (jobIds.length > 100) return NextResponse.json({ error: "Desclassifique no máximo 100 vagas por vez." }, { status: 400 });

  const db = getDb();
  const [existingJobs, analyses] = await Promise.all([
    db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.id, jobIds)),
    db.select().from(userJobAnalyses).where(and(eq(userJobAnalyses.userId, user.userId), inArray(userJobAnalyses.jobId, jobIds))),
  ]);
  if (existingJobs.length !== jobIds.length) return NextResponse.json({ error: "Uma ou mais vagas não foram encontradas." }, { status: 404 });

  const analysisByJobId = new Map(analyses.map((analysis) => [analysis.jobId, analysis]));
  const jobIdsWithoutAnalysis = jobIds.filter((jobId) => !analysisByJobId.has(jobId));

  let freshVersions: { profileRevision: string; rulesRevision: string; instructionsRevision: string } | null = null;
  let profileUpdatedAt: Date | null = null;
  if (jobIdsWithoutAnalysis.length) {
    const profile = await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0]);
    if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de desclassificar uma vaga sem avaliação." }, { status: 412 });
    freshVersions = getAnalysisVersions(canonicalizeProfile(profile));
    profileUpdatedAt = profile.updatedAt;
  }

  const now = new Date();
  const batchId = crypto.randomUUID();
  const label = "Desclassificada manualmente";
  const blocker = "Decisão manual do administrador";
  await db.insert(triageBatches).values({ id: batchId, userId: user.userId, trigger: "manual", scope: "manual-disqualification", status: "completed", startedAt: now, completedAt: now, createdAt: now });

  // Vagas já avaliadas: preserva as revisões e o "rows" da avaliação
  // existente, igual ao comportamento anterior.
  if (analyses.length) {
    await db.insert(triageHistory).values(analyses.map((analysis) => ({
      id: crypto.randomUUID(), batchId, userId: user.userId, jobId: analysis.jobId,
      profileRevision: analysis.profileRevision, rulesRevision: analysis.rulesRevision, instructionsRevision: analysis.instructionsRevision,
      verdict: "❌" as const, label, blocker, source: "rules" as const, confidence: 100, rows: analysis.rows, createdAt: now,
    })));
    await db.update(userJobAnalyses).set({ verdict: "❌" as const, label, blocker, source: "rules" as const, confidence: 100, updatedAt: now }).where(and(eq(userJobAnalyses.userId, user.userId), inArray(userJobAnalyses.jobId, jobIds)));
  }

  // Vagas sem avaliação prévia: cria a avaliação diretamente com o veredito
  // manual, usando as revisões atuais do perfil — não há revisão anterior
  // para herdar.
  if (jobIdsWithoutAnalysis.length && freshVersions && profileUpdatedAt) {
    const versions = freshVersions;
    await db.insert(triageHistory).values(jobIdsWithoutAnalysis.map((jobId) => ({
      id: crypto.randomUUID(), batchId, userId: user.userId, jobId,
      profileRevision: versions.profileRevision, rulesRevision: versions.rulesRevision, instructionsRevision: versions.instructionsRevision,
      verdict: "❌" as const, label, blocker, source: "rules" as const, confidence: 100, rows: "[]", createdAt: now,
    })));
    for (const jobId of jobIdsWithoutAnalysis) {
      await db.insert(userJobAnalyses).values({
        userId: user.userId, jobId, profileVersion: profileUpdatedAt,
        profileRevision: versions.profileRevision, rulesRevision: versions.rulesRevision, instructionsRevision: versions.instructionsRevision,
        verdict: "❌" as const, label, blocker, rows: "[]", matchingSkills: "[]", missingSkills: "[]", source: "rules" as const, confidence: 100, createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [userJobAnalyses.userId, userJobAnalyses.jobId],
        set: { verdict: "❌" as const, label, blocker, source: "rules" as const, confidence: 100, updatedAt: now },
      });
    }
  }

  await db.update(draftOutbox).set({ status: "cancelled", error: "Cancelado: vaga desclassificada manualmente.", updatedAt: now }).where(and(eq(draftOutbox.userId, user.userId), inArray(draftOutbox.jobId, jobIds), eq(draftOutbox.status, "pending")));
  return NextResponse.json({ ok: true, count: jobIds.length, verdict: "❌", cancelledPendingDraft: true });
}
