import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, triageBatches, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";

export const dynamic = "force-dynamic";

type DisqualifyRequest = { jobId?: string; jobIds?: string[] };

/** Registra uma decisão humana sem apagar avaliação ou rascunho já criado. */
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
  if (analyses.length !== jobIds.length) return NextResponse.json({ error: "Uma ou mais vagas ainda não possuem avaliação para desclassificar." }, { status: 409 });

  const now = new Date();
  const batchId = crypto.randomUUID();
  const label = "Desclassificada manualmente";
  const blocker = "Decisão manual do administrador";
  await db.insert(triageBatches).values({ id: batchId, userId: user.userId, trigger: "manual", scope: "manual-disqualification", status: "completed", startedAt: now, completedAt: now, createdAt: now });
  await db.insert(triageHistory).values(analyses.map((analysis) => ({
    id: crypto.randomUUID(), batchId, userId: user.userId, jobId: analysis.jobId,
    profileRevision: analysis.profileRevision, rulesRevision: analysis.rulesRevision, instructionsRevision: analysis.instructionsRevision,
    verdict: "❌", label, blocker, source: "rules", confidence: 100, rows: analysis.rows, createdAt: now,
  })));
  await db.update(userJobAnalyses).set({ verdict: "❌", label, blocker, source: "rules", confidence: 100, updatedAt: now }).where(and(eq(userJobAnalyses.userId, user.userId), inArray(userJobAnalyses.jobId, jobIds)));
  await db.update(draftOutbox).set({ status: "cancelled", error: "Cancelado: vaga desclassificada manualmente.", updatedAt: now }).where(and(eq(draftOutbox.userId, user.userId), inArray(draftOutbox.jobId, jobIds), eq(draftOutbox.status, "pending")));
  return NextResponse.json({ ok: true, count: jobIds.length, verdict: "❌", cancelledPendingDraft: true });
}
