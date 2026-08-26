import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobEvents, jobs, userJobStatus } from "../../../../../db/schema";
import { createNotification, notifyDetectedApplication } from "../../../../../lib/notifications";
import { resolveAutomaticStage } from "../../../../../lib/pipeline-stage";

export const dynamic = "force-dynamic";
type LinkedInState = "closed" | "sent";

/** Persiste somente um sinal que a extensão leu na página autenticada do LinkedIn. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const body = await request.json().catch(() => null) as { state?: LinkedInState; evidence?: string } | null;
  if (!body?.state || !["closed", "sent"].includes(body.state)) return NextResponse.json({ error: "Sinal do LinkedIn inválido" }, { status: 400 });
  const evidence = body.evidence?.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!evidence) return NextResponse.json({ error: "A evidência exibida pelo LinkedIn é obrigatória" }, { status: 400 });
  const { id } = await params;
  const db = getDb();
  const [job, existing] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.id, id)).limit(1).then((rows) => rows[0]),
    db.select().from(userJobStatus).where(and(eq(userJobStatus.userId, user.userId), eq(userJobStatus.jobId, id))).limit(1).then((rows) => rows[0]),
  ]);
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  const now = new Date();
  if (body.state === "closed") {
    const changed = job.status !== "closed";
    if (changed) {
      await db.update(jobs).set({ status: "closed", updatedAt: now }).where(eq(jobs.id, id));
      await db.insert(jobEvents).values({ jobId: id, type: "linkedin_application_closed", detail: evidence, occurredAt: now });
      await createNotification(db, {
        type: "application",
        severity: "info",
        title: `Vaga encerrada no LinkedIn — ${job.company}`,
        body: `${job.title}${job.externalId ? ` (vaga ${job.externalId})` : ""} · LinkedIn informou: ${evidence}`,
        link: `/?job=${encodeURIComponent(id)}`,
        metadata: { jobId: id, externalId: job.externalId, evidence, detectedAt: now.toISOString(), source: "linkedin-page" },
      });
    }
    return NextResponse.json({ ok: true, changed, state: "closed" });
  }
  const applicationStatus = existing?.applicationStatus === "responded" ? "responded" as const : "sent" as const;
  const values = { userId: user.userId, jobId: id, stage: resolveAutomaticStage(existing?.stage, "applied"), note: `LinkedIn confirmou candidatura: ${evidence}`, applicationStatus, generatedAt: existing?.generatedAt ?? now, sentAt: existing?.sentAt ?? now, respondedAt: existing?.respondedAt ?? null, updatedAt: now };
  const changed = existing?.applicationStatus !== applicationStatus || existing.note !== values.note;
  if (changed) {
    await db.insert(userJobStatus).values(values).onConflictDoUpdate({ target: [userJobStatus.userId, userJobStatus.jobId], set: { stage: values.stage, note: values.note, applicationStatus: values.applicationStatus, generatedAt: values.generatedAt, sentAt: values.sentAt, respondedAt: values.respondedAt, updatedAt: now } });
    await db.insert(jobEvents).values({ jobId: id, type: "linkedin_application_sent", detail: evidence, occurredAt: now });
    await notifyDetectedApplication(db, { jobId: id, title: job.title, company: job.company, externalId: job.externalId, evidence, detectedAt: now });
  }
  return NextResponse.json({ ok: true, changed, state: "sent", application: values });
}
