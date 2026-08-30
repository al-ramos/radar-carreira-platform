import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { jobs, userJobStatus } from "../../../db/schema";
import { resolveAutomaticStage } from "../../../lib/pipeline-stage";

type ApiPipelineStage = "viewed" | "saved" | "applied" | "interview" | "offer" | "rejected" | "archived";
type JobPriority = "must_apply" | "high" | "watch";
const VALID_STAGES = new Set<ApiPipelineStage>(["viewed", "saved", "applied", "interview", "offer", "rejected", "archived"]);
const VALID_PRIORITIES = new Set<JobPriority>(["must_apply", "high", "watch"]);
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const rows = await getDb().select({ job: jobs, stage: userJobStatus.stage, note: userJobStatus.note, priority: userJobStatus.priority, applicationStatus: userJobStatus.applicationStatus, generatedAt: userJobStatus.generatedAt, sentAt: userJobStatus.sentAt, respondedAt: userJobStatus.respondedAt, updatedAt: userJobStatus.updatedAt })
    .from(userJobStatus)
    .innerJoin(jobs, eq(jobs.id, userJobStatus.jobId))
    .where(eq(userJobStatus.userId, user.userId))
    .orderBy(desc(userJobStatus.updatedAt));
  return NextResponse.json({ items: rows.map(row => ({ ...row.job, stack: JSON.parse(row.job.stack || "[]"), stage: row.stage, note: row.note, priority: row.priority, applicationStatus: row.applicationStatus, generatedAt: row.generatedAt, sentAt: row.sentAt, respondedAt: row.respondedAt, pipelineUpdatedAt: row.updatedAt })) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const body = await request.json() as { jobId?: string; stage?: string; note?: string; priority?: string | null; mode?: "replace" | "advance" };
  if (!body.jobId || !body.stage || !VALID_STAGES.has(body.stage as ApiPipelineStage)) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  if (body.priority !== undefined && body.priority !== null && !VALID_PRIORITIES.has(body.priority as JobPriority)) return NextResponse.json({ error: "Prioridade inválida" }, { status: 400 });

  const db = getDb();
  const [job, existing] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.id, body.jobId)).limit(1).then(rows => rows[0]),
    db.select().from(userJobStatus).where(and(eq(userJobStatus.userId, user.userId), eq(userJobStatus.jobId, body.jobId))).limit(1).then(rows => rows[0]),
  ]);
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });

  const requestedStage = body.stage as ApiPipelineStage;
  const stage = body.mode === "advance" && (requestedStage === "viewed" || requestedStage === "saved" || requestedStage === "applied")
    ? resolveAutomaticStage(existing?.stage, requestedStage)
    : requestedStage;
  const values = { userId: user.userId, jobId: body.jobId, stage, note: body.note === undefined ? existing?.note ?? null : body.note, priority: body.priority === undefined ? existing?.priority ?? null : body.priority, updatedAt: new Date() };
  if (existing && existing.stage === stage && existing.note === values.note && existing.priority === values.priority) {
    return NextResponse.json({ ok: true, stage, changed: false });
  }
  await db.insert(userJobStatus).values(values).onConflictDoUpdate({ target: [userJobStatus.userId, userJobStatus.jobId], set: { stage: values.stage, note: values.note, priority: values.priority, updatedAt: values.updatedAt } });
  return NextResponse.json({ ok: true, stage: values.stage, priority: values.priority, changed: true });
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const body = await request.json() as { jobId?: string };
  if (!body.jobId) return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  await getDb().delete(userJobStatus).where(and(eq(userJobStatus.userId, user.userId), eq(userJobStatus.jobId, body.jobId)));
  return NextResponse.json({ ok: true });
}
