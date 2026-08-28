import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, triageBatches, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";

export const dynamic = "force-dynamic";

type DisqualifyRequest = { jobId?: string };

/** Registra uma decisão humana sem apagar avaliação ou rascunho já criado. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as DisqualifyRequest;
  const jobId = body.jobId?.trim();
  if (!jobId) return NextResponse.json({ error: "Informe a vaga a desclassificar." }, { status: 400 });

  const db = getDb();
  const [job, analysis] = await Promise.all([
    db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1).then((rows) => rows[0]),
    db.select().from(userJobAnalyses).where(and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, jobId))).limit(1).then((rows) => rows[0]),
  ]);
  if (!job) return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 });
  if (!analysis) return NextResponse.json({ error: "A vaga ainda não possui uma avaliação para desclassificar." }, { status: 409 });

  const now = new Date();
  const batchId = crypto.randomUUID();
  const label = "Desclassificada manualmente";
  const blocker = "Decisão manual do administrador";
  await db.insert(triageBatches).values({ id: batchId, userId: user.userId, trigger: "manual", scope: "manual-disqualification", status: "completed", startedAt: now, completedAt: now, createdAt: now });
  await db.insert(triageHistory).values({
    id: crypto.randomUUID(), batchId, userId: user.userId, jobId,
    profileRevision: analysis.profileRevision, rulesRevision: analysis.rulesRevision, instructionsRevision: analysis.instructionsRevision,
    verdict: "❌", label, blocker, source: "rules", confidence: 100, rows: analysis.rows, createdAt: now,
  });
  await db.update(userJobAnalyses).set({ verdict: "❌", label, blocker, source: "rules", confidence: 100, updatedAt: now }).where(and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, jobId)));
  await db.update(draftOutbox).set({ status: "cancelled", error: "Cancelado: vaga desclassificada manualmente.", updatedAt: now }).where(and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.jobId, jobId), eq(draftOutbox.status, "pending")));
  return NextResponse.json({ ok: true, verdict: "❌", cancelledPendingDraft: true });
}
