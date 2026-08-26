import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db/index";
import { jobEvents, jobSources, jobs, userJobStatus } from "../../../../db/schema";
import { createNotification, notifyDetectedApplication } from "../../../../lib/notifications";
import { resolveAutomaticStage } from "../../../../lib/pipeline-stage";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
};
const json = (body: unknown, init?: ResponseInit) => NextResponse.json(body, { ...init, headers: { ...CORS_HEADERS, ...init?.headers } });
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");

type StatusPayload = {
  externalId?: string;
  status?: "submitted" | "already_applied" | "closed";
  evidence?: string;
  url?: string;
  observedAt?: string;
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Recebe somente um estado que o próprio LinkedIn exibiu na página da vaga.
 * A extensão não envia candidaturas nem interpreta falha de carregamento como
 * encerramento; por isso a entrada aceita apenas os três sinais explícitos.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Chave do coletor ausente" }, { status: 401 });
  const payload = await request.json().catch(() => null) as StatusPayload | null;
  const externalId = String(payload?.externalId ?? "").trim();
  const status = payload?.status;
  const evidence = String(payload?.evidence ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!/^\d{4,30}$/.test(externalId) || !status || !["submitted", "already_applied", "closed"].includes(status) || !evidence)
    return json({ error: "Status de candidatura inválido" }, { status: 400 });

  const db = getDb();
  const source = (await db.select().from(jobSources).where(eq(jobSources.id, "linkedin-extension")).limit(1))[0];
  let config: { hash?: string; userId?: string } = {};
  try { config = source ? JSON.parse(source.externalRef) as typeof config : {}; } catch { /* configuração inválida */ }
  if (!source || !source.enabled || !config.hash || config.hash !== await digest(token)) return json({ error: "Chave do coletor inválida" }, { status: 401 });

  const job = (await db.select().from(jobs).where(and(eq(jobs.sourceId, "linkedin-extension"), eq(jobs.externalId, externalId))).limit(1))[0];
  if (!job) return json({ error: "Vaga do LinkedIn não encontrada no Radar" }, { status: 404 });
  const observedAt = payload?.observedAt && !Number.isNaN(Date.parse(payload.observedAt)) ? new Date(payload.observedAt) : new Date();

  if (status === "closed") {
    const changed = job.status !== "closed";
    if (changed) {
      await db.update(jobs).set({ status: "closed", updatedAt: observedAt }).where(eq(jobs.id, job.id));
      await createNotification(db, {
        type: "application", severity: "info", title: `Vaga encerrada no LinkedIn — ${job.company}`,
        body: `${job.title} (vaga ${externalId}) · LinkedIn informou: ${evidence}`,
        link: `/?job=${encodeURIComponent(job.id)}`,
        metadata: { jobId: job.id, externalId, evidence, observedAt: observedAt.toISOString(), source: "linkedin-page" },
      });
    }
    await db.insert(jobEvents).values({ jobId: job.id, type: "linkedin_application_closed", detail: JSON.stringify({ evidence, url: payload?.url ?? null, changed }), occurredAt: observedAt });
    return json({ ok: true, changed, status: "closed", jobId: job.id });
  }

  const existing = config.userId
    ? (await db.select().from(userJobStatus).where(and(eq(userJobStatus.userId, config.userId), eq(userJobStatus.jobId, job.id))).limit(1))[0]
    : undefined;
  const previous = existing?.applicationStatus;
  const applicationStatus = previous === "responded" ? "responded" : "sent";
  const stage = resolveAutomaticStage(existing?.stage, "applied");
  const note = [existing?.note, `LinkedIn (${status === "submitted" ? "candidatura enviada" : "já candidatado"}): ${evidence}`].filter(Boolean).join("\n").slice(-2000);
  if (config.userId) await db.insert(userJobStatus).values({
    userId: config.userId, jobId: job.id, stage, note, applicationStatus,
    generatedAt: existing?.generatedAt ?? observedAt,
    sentAt: existing?.sentAt ?? observedAt,
    respondedAt: existing?.respondedAt ?? null,
    updatedAt: observedAt,
  }).onConflictDoUpdate({
    target: [userJobStatus.userId, userJobStatus.jobId],
    set: { stage, note, applicationStatus, generatedAt: existing?.generatedAt ?? observedAt, sentAt: existing?.sentAt ?? observedAt, respondedAt: existing?.respondedAt ?? null, updatedAt: observedAt },
  });
  const changed = previous !== "sent" && previous !== "responded";
  await db.insert(jobEvents).values({ jobId: job.id, type: "linkedin_application_confirmed", detail: JSON.stringify({ status, evidence, url: payload?.url ?? null, changed }), occurredAt: observedAt });
  if (changed) await notifyDetectedApplication(db, { jobId: job.id, title: job.title, company: job.company, externalId: job.externalId, evidence, detectedAt: observedAt });
  return json({ ok: true, changed, status: applicationStatus, jobId: job.id });
}
