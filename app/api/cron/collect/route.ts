import { asc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db/index";
import { importRuns, jobSources, jobs, platformSettings } from "../../../../db/schema";
import { collect, isPullProvider } from "../../../../lib/connectors";
import { fingerprint, recordedJobDate, sourcePublishedJobDate } from "../../../../lib/jobs";
import { inferJobArea } from "../../../../lib/job-area";
import { recordImportRunJobs } from "../../../../lib/import-tracking";
import { notifyImportRun } from "../../../../lib/notifications";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 1;
const LOOKUP_BATCH_SIZE = 100;
const WRITE_BATCH_SIZE = 50;

const chunks = <T,>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );

export async function POST(request: Request) {
  if (request.headers.get("x-radar-collector-authenticated") !== "1") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const config = (await getDb().select().from(platformSettings).where(eq(platformSettings.id, "global")).limit(1))[0];
  if (config && !config.collectionEnabled) {
    return NextResponse.json({ ok: true, skipped: true, message: "Coleta pausada pelo administrador" });
  }

  const offset = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);
  const sources = (await getDb().select().from(jobSources).where(eq(jobSources.enabled, true)).orderBy(asc(jobSources.id)))
    .filter((source) => source.collectionMode === "pull" && isPullProvider(source.provider));
  const batch = sources.slice(offset, offset + BATCH_SIZE);
  let received = 0;
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const source of batch) {
    const runId = crypto.randomUUID();
    const startedAt = new Date();
    await getDb().insert(importRuns).values({ id: runId, source: source.name, sourceId: source.id, channel: "connector", status: "running", received: 0, actorUserId: "scheduler", startedAt });
    await getDb().update(jobSources).set({ lastAttemptAt: startedAt }).where(eq(jobSources.id, source.id));

    try {
      const found = await collect(source.provider, source.externalRef, source.name);
      received += found.length;
      let sourceInserted = 0;
      let sourceUpdated = 0;

      // Uma fonte pode devolver centenas de vagas. Consultar e gravar cada
      // item isoladamente esgota o tempo do Worker e derruba a próxima fonte
      // com 500/503. Mantemos a coleta em uma fonte por chamada, mas usamos
      // leituras e escritas D1 em lote dentro dela.
      const entries = [...new Map(found.map((job) => [fingerprint(job), job])).entries()]
        .map(([jobFingerprint, job]) => ({ jobFingerprint, job }));
      const existing = new Set<string>();
      for (const fingerprintBatch of chunks(entries.map((entry) => entry.jobFingerprint), LOOKUP_BATCH_SIZE)) {
        const rows = await getDb()
          .select({ fingerprint: jobs.fingerprint })
          .from(jobs)
          .where(inArray(jobs.fingerprint, fingerprintBatch));
        rows.forEach((row) => existing.add(row.fingerprint));
      }

      for (const entryBatch of chunks(entries, WRITE_BATCH_SIZE)) {
        const now = new Date();
        const statements = entryBatch.map(({ job, jobFingerprint }) => {
          const values = {
            id: crypto.randomUUID(), fingerprint: jobFingerprint, sourceId: source.id,
            externalId: job.externalId ?? null, company: job.company, title: job.title, seniority: job.seniority ?? null,
            workMode: job.workMode ?? null, location: job.location ?? null, stack: JSON.stringify(job.stack ?? []),
            publishedAt: recordedJobDate(job.publishedAt, now), sourcePublishedAt: sourcePublishedJobDate(job.publishedAt), ingestionMode: "automatic" as const, ingestionChannel: "connector" as const, roleArea: inferJobArea(job),
            url: job.url, description: job.description ?? "",
            firstSeenAt: now, lastSeenAt: now, status: "active" as const, createdAt: now, updatedAt: now,
          };
          return getDb().insert(jobs).values(values).onConflictDoUpdate({
            target: jobs.fingerprint,
            set: { sourceId: source.id, title: values.title, location: values.location, workMode: values.workMode, ingestionChannel: values.ingestionChannel, roleArea: values.roleArea, publishedAt: values.publishedAt, sourcePublishedAt: sql`coalesce(${values.sourcePublishedAt}, ${jobs.sourcePublishedAt})`, url: values.url, description: values.description, lastSeenAt: now, status: "active", updatedAt: now },
          });
        });
        if (statements.length) {
          await getDb().batch(statements as [typeof statements[number], ...typeof statements[number][]]);
          await recordImportRunJobs(getDb(),runId,entryBatch.map(entry=>entry.jobFingerprint),existing,now);
        }
        entryBatch.forEach((entry) => existing.has(entry.jobFingerprint) ? sourceUpdated++ : sourceInserted++);
      }

      inserted += sourceInserted;
      updated += sourceUpdated;
      const finishedAt = new Date();
      await getDb().update(importRuns).set({ status: "completed", received: found.length, inserted: sourceInserted, updated: sourceUpdated, finishedAt }).where(eq(importRuns.id, runId));
      await getDb().update(jobSources).set({ lastRunAt: finishedAt, lastSuccessAt: finishedAt, lastError: null, consecutiveFailures: 0 }).where(eq(jobSources.id, source.id));
    } catch (error) {
      errors++;
      const message = error instanceof Error ? error.message.slice(0, 300) : "Falha desconhecida na coleta";
      await getDb().update(importRuns).set({ status: "failed", errors: 1, finishedAt: new Date() }).where(eq(importRuns.id, runId));
      await getDb().update(jobSources).set({ lastError: message, consecutiveFailures: source.consecutiveFailures + 1 }).where(eq(jobSources.id, source.id));
      // Só falha notifica aqui: a coleta roda uma fonte por chamada, dezenas
      // de vezes por dia, e sucesso por fonte inundaria o sino. Falha é o
      // caso que precisa de atenção proativa (P0-04: alertar administradores
      // após falhas de coleta).
      await notifyImportRun(getDb(), { runId, source: source.name, status: "failed", received: 0, inserted: 0, updated: 0, error: message }).catch(() => undefined);
    }
  }

  return NextResponse.json({
    ok: errors === 0,
    sources: batch.length,
    totalSources: sources.length,
    received,
    inserted,
    updated,
    errors,
    nextOffset: offset + batch.length < sources.length ? offset + batch.length : null,
  });
}
