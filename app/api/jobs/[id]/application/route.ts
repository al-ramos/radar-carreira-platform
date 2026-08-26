import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobs, userJobStatus } from "../../../../../db/schema";
import { resolveAutomaticStage } from "../../../../../lib/pipeline-stage";

export const dynamic = "force-dynamic";
const STATUSES = ["opened", "generated", "sent", "responded"] as const;
type ApplicationStatus = typeof STATUSES[number];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const body = await request.json().catch(() => null) as { status?: ApplicationStatus; stage?: "saved" | "applied" } | null;
  if (!body?.status || !STATUSES.includes(body.status)) return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  const { id } = await params;
  const db = getDb();
  const [job, existing] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.id, id)).limit(1).then(rows => rows[0]),
    db.select().from(userJobStatus).where(and(eq(userJobStatus.userId, user.userId), eq(userJobStatus.jobId, id))).limit(1).then(rows => rows[0]),
  ]);
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });

  const requestedRank = STATUSES.indexOf(body.status);
  const currentRank = existing?.applicationStatus ? STATUSES.indexOf(existing.applicationStatus) : -1;
  const status = (requestedRank >= currentRank ? body.status : existing?.applicationStatus) as ApplicationStatus;
  const now = new Date();
  const requestedStage = body.stage ?? (status === "opened" || status === "generated" ? "saved" : "applied");
  const stage = resolveAutomaticStage(existing?.stage, requestedStage);
  const values = {
    userId: user.userId,
    jobId: id,
    stage,
    note: existing?.note ?? null,
    applicationStatus: status,
    generatedAt: existing?.generatedAt ?? now,
    sentAt: status === "sent" || status === "responded" ? existing?.sentAt ?? now : existing?.sentAt ?? null,
    respondedAt: status === "responded" ? existing?.respondedAt ?? now : existing?.respondedAt ?? null,
    updatedAt: now,
  };
  const unchanged = existing
    && existing.stage === values.stage
    && existing.applicationStatus === values.applicationStatus
    && existing.generatedAt?.getTime() === values.generatedAt.getTime()
    && (existing.sentAt?.getTime() ?? null) === (values.sentAt?.getTime() ?? null)
    && (existing.respondedAt?.getTime() ?? null) === (values.respondedAt?.getTime() ?? null);
  if (unchanged) return NextResponse.json({ ok: true, changed: false, application: { ...existing, stage } });
  await db.insert(userJobStatus).values(values).onConflictDoUpdate({
    target: [userJobStatus.userId, userJobStatus.jobId],
    set: { stage: values.stage, note: values.note, applicationStatus: values.applicationStatus, generatedAt: values.generatedAt, sentAt: values.sentAt, respondedAt: values.respondedAt, updatedAt: now },
  });
  return NextResponse.json({ ok: true, changed: true, application: values });
}
