import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { jobs, profiles, userJobStatus } from "../../../db/schema";
import { analyzeStoredJobForProfile } from "../../../lib/personalized-analysis";

const VALID_STAGES = new Set(["viewed", "saved", "applied", "interview", "rejected", "archived", "offer", "new"]);
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const rows = await getDb().select({ job: jobs, stage: userJobStatus.stage, note: userJobStatus.note, applicationStatus: userJobStatus.applicationStatus, generatedAt: userJobStatus.generatedAt, sentAt: userJobStatus.sentAt, respondedAt: userJobStatus.respondedAt, updatedAt: userJobStatus.updatedAt })
    .from(userJobStatus)
    .innerJoin(jobs, eq(jobs.id, userJobStatus.jobId))
    .where(eq(userJobStatus.userId, user.userId))
    .orderBy(desc(userJobStatus.updatedAt));
  return NextResponse.json({ items: rows.map(row => ({ ...row.job, stack: JSON.parse(row.job.stack || "[]"), stage: row.stage, note: row.note, applicationStatus: row.applicationStatus, generatedAt: row.generatedAt, sentAt: row.sentAt, respondedAt: row.respondedAt, pipelineUpdatedAt: row.updatedAt })) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const body = await request.json() as { jobId?: string; stage?: string; note?: string };
  if (!body.jobId || !body.stage || !VALID_STAGES.has(body.stage)) return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });

  const db = getDb();
  const [job, profile] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.id, body.jobId)).limit(1).then(rows => rows[0]),
    db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then(rows => rows[0]),
  ]);
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de acompanhar vagas" }, { status: 412 });
  const analysis = analyzeStoredJobForProfile(job, profile);
  if (!analysis) return NextResponse.json({ error: "Cadastre suas competências antes de acompanhar vagas" }, { status: 412 });
  if (!analysis.eligible) return NextResponse.json({ error: "Apenas vagas com veredito Bate ou Provável podem entrar no acompanhamento", verdict: analysis.verdict }, { status: 422 });

  const stage = body.stage as "viewed" | "saved" | "applied" | "interview" | "rejected" | "archived";
  const values = { userId: user.userId, jobId: body.jobId, stage, note: body.note ?? null, updatedAt: new Date() };
  if (stage === "viewed") {
    await db.insert(userJobStatus).values(values).onConflictDoNothing();
  } else {
    await db.insert(userJobStatus).values(values).onConflictDoUpdate({ target: [userJobStatus.userId, userJobStatus.jobId], set: { stage: values.stage, note: values.note, updatedAt: values.updatedAt } });
  }
  return NextResponse.json({ ok: true, stage: values.stage });
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const body = await request.json() as { jobId?: string };
  if (!body.jobId) return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  await getDb().delete(userJobStatus).where(and(eq(userJobStatus.userId, user.userId), eq(userJobStatus.jobId, body.jobId)));
  return NextResponse.json({ ok: true });
}
