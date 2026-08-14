import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db/index";
import { importRuns, jobSources, jobs, platformSettings } from "../../../../db/schema";
import { collect, isPullProvider } from "../../../../lib/connectors";
import { fingerprint } from "../../../../lib/jobs";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 1;

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
    await getDb().insert(importRuns).values({ id: runId, source: source.name, status: "running", received: 0, actorUserId: "scheduler", startedAt });
    await getDb().update(jobSources).set({ lastAttemptAt: startedAt }).where(eq(jobSources.id, source.id));

    try {
      const found = await collect(source.provider, source.externalRef, source.name);
      received += found.length;
      let sourceInserted = 0;
      let sourceUpdated = 0;

      for (const job of found) {
        const now = new Date();
        const jobFingerprint = fingerprint(job);
        const existing = (await getDb().select({ id: jobs.id }).from(jobs).where(eq(jobs.fingerprint, jobFingerprint)).limit(1))[0];
        const values = {
          id: existing?.id ?? crypto.randomUUID(), fingerprint: jobFingerprint, sourceId: source.id,
          externalId: job.externalId ?? null, company: job.company, title: job.title, seniority: job.seniority ?? null,
          workMode: job.workMode ?? null, location: job.location ?? null, stack: JSON.stringify(job.stack ?? []),
          publishedAt: job.publishedAt ? new Date(job.publishedAt) : null, url: job.url, description: job.description ?? "",
          firstSeenAt: now, lastSeenAt: now, status: "active" as const, createdAt: now, updatedAt: now,
        };
        await getDb().insert(jobs).values(values).onConflictDoUpdate({
          target: jobs.fingerprint,
          set: { sourceId: source.id, title: values.title, location: values.location, workMode: values.workMode, publishedAt: values.publishedAt, url: values.url, description: values.description, lastSeenAt: now, status: "active", updatedAt: now },
        });
        if (existing) sourceUpdated++; else sourceInserted++;
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
