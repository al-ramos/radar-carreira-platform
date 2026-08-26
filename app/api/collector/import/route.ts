import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../db/index";
import { importRuns, jobSources, jobs, profiles } from "../../../../db/schema";
import { filterImportedJobsByProfile } from "../../../../lib/collector-profile-filter";
import { normalizeImportedJobs } from "../../../../lib/import-jobs";
import { fingerprint, recordedJobDate, sourcePublishedJobDate, type ImportedJob } from "../../../../lib/jobs";
import { normalizeCareerRules } from "../../../../lib/profile-options";
import { inferJobArea } from "../../../../lib/job-area";
import { recordImportRunJobs } from "../../../../lib/import-tracking";
import { notifyImportRun } from "../../../../lib/notifications";
import { shouldArchiveImportedJob } from "../../../../lib/job-archive-policy";

export const dynamic = "force-dynamic";

const SOURCE_ID = "linkedin-extension";
const WRITE_BATCH_SIZE = 50;
const LOOKUP_BATCH_SIZE = 100;
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, "0")).join("");
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};
const json = (body: unknown, init?: ResponseInit) => Response.json(body, { ...init, headers: { ...CORS_HEADERS, ...init?.headers } });

const chunks = <T,>(values: T[], size: number) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

function valuesFor(job: ImportedJob, now: Date) {
  const sourcePublishedAt = sourcePublishedJobDate(job.publishedAt);
  return {
    id: crypto.randomUUID(),
    fingerprint: fingerprint(job),
    sourceId: SOURCE_ID,
    externalId: job.externalId ?? null,
    company: job.company,
    title: job.title,
    seniority: job.seniority ?? null,
    workMode: job.workMode ?? null,
    location: job.location ?? null,
    stack: JSON.stringify(job.stack ?? []),
    publishedAt: recordedJobDate(job.publishedAt, now),
    sourcePublishedAt,
    ingestionMode: "automatic" as const,
    ingestionChannel: "extension" as const,
    roleArea: inferJobArea(job),
    url: job.url,
    applyUrl: job.applyUrl ?? null,
    contactEmail: job.contactEmail ?? null,
    contactSubject: job.contactSubject ?? null,
    description: job.description ?? "",
    firstSeenAt: now,
    lastSeenAt: now,
    status: job.applicationClosed ? "closed" as const : shouldArchiveImportedJob(sourcePublishedAt, now) ? "archived" as const : "active" as const,
    createdAt: now,
    updatedAt: now,
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Chave do coletor ausente" }, { status: 401 });

  const db = getDb();
  const source = (await db.select().from(jobSources).where(eq(jobSources.id, SOURCE_ID)).limit(1))[0];
  let config: { hash?: string; userId?: string } = {};
  try { config = source ? JSON.parse(source.externalRef) as typeof config : {}; } catch { /* integração inválida */ }
  if (!source || !source.enabled || !config.hash || config.hash !== await digest(token)) return json({ error: "Chave do coletor inválida" }, { status: 401 });

  const payload = await request.json().catch(() => null) as { action?: string; jobs?: unknown[] } | null;
  if (payload?.action === "test") return json({ ok: true, connected: true });
  const items = normalizeImportedJobs(Array.isArray(payload?.jobs) ? payload.jobs : []);
  if (!items.length) return json({ error: "Nenhuma vaga válida recebida" }, { status: 400 });
  if (items.length > 2000) return json({ error: "O limite é de 2.000 vagas por envio" }, { status: 400 });

  const profile = config.userId
    ? (await db.select({ careerRules: profiles.careerRules }).from(profiles).where(eq(profiles.userId, config.userId)).limit(1))[0]
    : undefined;
  const careerRules = normalizeCareerRules(profile?.careerRules);
  const filtered = filterImportedJobsByProfile(items, {
    requiredStacks: careerRules.coreStack,
    stackMatchMode: careerRules.coreStackMatchMode,
  });
  const entries = [...new Map(filtered.accepted.map(job => [fingerprint(job), job])).entries()].map(([fp, job]) => ({ fp, job }));
  const duplicateRows = filtered.accepted.length - entries.length;
  const runId = crypto.randomUUID();
  const startedAt = new Date();
  await db.insert(importRuns).values({ id: runId, source: "Extensão LinkedIn", sourceId: SOURCE_ID, channel: "extension", status: "running", received: items.length, duplicates: duplicateRows, actorUserId: config.userId ?? "collector", startedAt });

  let inserted = 0;
  let updated = 0;
  try {
    if (!entries.length) {
      await db.update(importRuns).set({ status: "completed", finishedAt: new Date() }).where(eq(importRuns.id, runId));
      await db.update(jobSources).set({ lastRunAt: new Date() }).where(eq(jobSources.id, SOURCE_ID));
      await notifyImportRun(db, { runId, source: "Extensão LinkedIn", status: "completed", received: items.length, inserted: 0, updated: 0, duplicates: 0 }).catch(() => undefined);
      return json({ ok: true, accepted: 0, received: items.length, duplicates: 0, rejected: filtered.rejected, inserted: 0, updated: 0, requiredStacks: filtered.requiredStacks, stackMatchMode: filtered.stackMatchMode, message: "Nenhuma vaga atende ao perfil de stacks obrigatórias" });
    }
    const existing = new Set<string>();
    for (const batch of chunks(entries.map(entry => entry.fp), LOOKUP_BATCH_SIZE)) {
      const rows = await db.select({ fingerprint: jobs.fingerprint }).from(jobs).where(inArray(jobs.fingerprint, batch));
      rows.forEach(row => existing.add(row.fingerprint));
    }

    for (const batch of chunks(entries, WRITE_BATCH_SIZE)) {
      const now = new Date();
      const statements = batch.map(({ job }) => {
        const values = valuesFor(job, now);
        return db.insert(jobs).values(values).onConflictDoUpdate({
          target: jobs.fingerprint,
          set: {
            sourceId: SOURCE_ID,
            externalId: values.externalId,
            company: values.company,
            title: values.title,
            seniority: values.seniority,
            workMode: values.workMode,
            location: values.location,
            stack: values.stack,
            ingestionChannel: values.ingestionChannel,
            roleArea: values.roleArea,
            publishedAt: values.publishedAt,
            sourcePublishedAt: sql`coalesce(${values.sourcePublishedAt?.getTime() ?? null}, ${jobs.sourcePublishedAt})`,
            url: values.url,
            applyUrl: values.applyUrl,
            contactEmail: sql`coalesce(${values.contactEmail}, ${jobs.contactEmail})`,
            contactSubject: sql`coalesce(${values.contactSubject}, ${jobs.contactSubject})`,
            description: values.description,
            lastSeenAt: now,
            status: values.status === "closed" ? "closed" : values.status === "archived" ? "archived" : sql`case when ${jobs.status} in ('archived', 'closed') then ${jobs.status} else 'active' end`,
            updatedAt: now,
          },
        });
      });
      await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
      await recordImportRunJobs(db, runId, batch.map(entry => entry.fp), existing, now);
      batch.forEach(entry => existing.has(entry.fp) ? updated++ : inserted++);
      await db.update(importRuns).set({ inserted, updated, duplicates: duplicateRows }).where(eq(importRuns.id, runId));
    }

    await db.update(importRuns).set({ status: "completed", inserted, updated, duplicates: duplicateRows, finishedAt: new Date() }).where(eq(importRuns.id, runId));
    await db.update(jobSources).set({ lastRunAt: new Date() }).where(eq(jobSources.id, SOURCE_ID));
    await notifyImportRun(db, { runId, source: "Extensão LinkedIn", status: "completed", received: items.length, inserted, updated, duplicates: duplicateRows }).catch(() => undefined);
    return json({ ok: true, accepted: filtered.accepted.length, received: items.length, duplicates: duplicateRows, rejected: filtered.rejected, inserted, updated, requiredStacks: filtered.requiredStacks, stackMatchMode: filtered.stackMatchMode });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Falha desconhecida durante a gravação";
    await db.update(importRuns).set({ status: "failed", inserted, updated, duplicates: duplicateRows, errors: 1, finishedAt: new Date() }).where(eq(importRuns.id, runId)).catch(() => undefined);
    await notifyImportRun(db, { runId, source: "Extensão LinkedIn", status: "failed", received: items.length, inserted, updated, duplicates: duplicateRows, error: detail.slice(0, 300) }).catch(() => undefined);
    return json({ error: "A importação foi interrompida. Reenvie o mesmo lote para concluir as vagas pendentes.", runId, inserted, updated }, { status: 500 });
  }
}
