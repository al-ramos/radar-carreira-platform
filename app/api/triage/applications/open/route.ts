import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobs, userJobStatus } from "../../../../../db/schema";
import { resolveAutomaticStage } from "../../../../../lib/pipeline-stage";

export const dynamic = "force-dynamic";

/** Registra somente a abertura do portal de candidatura; nunca submete formulários. */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { jobIds?: unknown };
  const jobIds = Array.isArray(body.jobIds)
    ? [...new Set(body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 20)
    : [];
  if (!jobIds.length) return NextResponse.json({ error: "Selecione ao menos uma vaga" }, { status: 400 });

  const db = getDb();
  const rows = await db.select({ job: jobs, application: userJobStatus })
    .from(jobs).leftJoin(userJobStatus, and(eq(userJobStatus.jobId, jobs.id), eq(userJobStatus.userId, user.userId)))
    .where(inArray(jobs.id, jobIds));
  const openable: Array<{ jobId: string; destination: string }> = [];
  let alreadySent = 0, unavailable = 0, noDestination = 0;
  const now = new Date();
  for (const { job, application } of rows) {
    if (job.status !== "active" || application?.stage === "rejected" || application?.stage === "archived") { unavailable += 1; continue; }
    if (application?.applicationStatus === "sent" || application?.applicationStatus === "responded") { alreadySent += 1; continue; }
    const destination = job.applyUrl || job.url;
    if (!destination) { noDestination += 1; continue; }
    const values = {
      userId: user.userId, jobId: job.id,
      stage: resolveAutomaticStage(application?.stage, "saved"),
      note: "Portal de candidatura aberto pelo Radar; envio ainda não confirmado.",
      applicationStatus: application?.applicationStatus === "generated" ? "generated" as const : "opened" as const,
      generatedAt: application?.generatedAt ?? now,
      sentAt: application?.sentAt ?? null,
      respondedAt: application?.respondedAt ?? null,
      updatedAt: now,
    };
    await db.insert(userJobStatus).values(values).onConflictDoUpdate({
      target: [userJobStatus.userId, userJobStatus.jobId],
      set: { stage: values.stage, note: values.note, applicationStatus: values.applicationStatus, generatedAt: values.generatedAt, sentAt: values.sentAt, respondedAt: values.respondedAt, updatedAt: now },
    });
    openable.push({ jobId: job.id, destination });
  }
  return NextResponse.json({ ok: true, considered: rows.length, openable, alreadySent, unavailable, noDestination });
}
