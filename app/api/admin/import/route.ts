import { eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { importRuns, jobs } from "../../../../db/schema";
import { fingerprint, recordedJobDate, sourcePublishedJobDate, type ImportedJob } from "../../../../lib/jobs";
import { parseCsvJobs } from "../../../../lib/csv-jobs";
import { normalizeImportedJobs } from "../../../../lib/import-jobs";
import { can } from "../../../../lib/rbac";

export const dynamic = "force-dynamic";

const WRITE_BATCH_SIZE = 50;
const LOOKUP_BATCH_SIZE = 100;

const chunks = <T,>(values: T[], size: number) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

async function payload(request: Request): Promise<ImportedJob[]> {
  const type = request.headers.get("content-type") ?? "";
  const text = await request.text();
  if (text.length > 2_000_000) throw new Error(type.includes("text/csv") ? "Arquivo CSV excede 2 MB" : "Arquivo JSON excede 2 MB");
  if (type.includes("text/csv")) return parseCsvJobs(text);
  const value = JSON.parse(text) as unknown;
  const rows = Array.isArray(value) ? value : value && typeof value === "object" && (value as { jobs?: unknown }).jobs;
  return normalizeImportedJobs(Array.isArray(rows) ? rows : []);
}

function valuesFor(job: ImportedJob, now: Date) {
  return {
    id: crypto.randomUUID(),
    fingerprint: fingerprint(job),
    sourceId: job.sourceId ?? null,
    externalId: job.externalId ?? null,
    company: job.company.trim(),
    title: job.title.trim(),
    seniority: job.seniority ?? null,
    workMode: job.workMode ?? null,
    location: job.location ?? null,
    stack: JSON.stringify(job.stack ?? []),
    publishedAt: recordedJobDate(job.publishedAt, now),
    sourcePublishedAt: sourcePublishedJobDate(job.publishedAt),
    ingestionMode: "manual" as const,
    url: job.url,
    applyUrl: job.applyUrl ?? null,
    contactEmail: job.contactEmail ?? null,
    contactSubject: job.contactSubject ?? null,
    description: job.description ?? "",
    firstSeenAt: now,
    lastSeenAt: now,
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
  };
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  if (!await can(user, "import.run")) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  const db = getDb();

  let items: ImportedJob[];
  try { items = await payload(request); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Formato inválido" }, { status: 400 }); }
  if (!items.length) return NextResponse.json({ error: "Envie vagas em JSON ou CSV com cabeçalhos válidos" }, { status: 400 });
  if (items.length > 2000) return NextResponse.json({ error: "O limite é de 2.000 vagas por importação" }, { status: 400 });

  const entries = [...new Map(items.map(job => [fingerprint(job), job])).entries()].map(([fp, job]) => ({ fp, job }));
  const duplicateRows = items.length - entries.length;
  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const source = request.headers.get("content-type")?.includes("text/csv") ? "csv" : "manual";
  await db.insert(importRuns).values({ id: runId, source, status: "running", received: items.length, duplicates: duplicateRows, actorUserId: user.userId, startedAt });

  let inserted = 0;
  let updated = 0;
  try {
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
            sourceId: values.sourceId,
            externalId: values.externalId,
            company: values.company,
            title: values.title,
            seniority: values.seniority,
            workMode: values.workMode,
            location: values.location,
            stack: values.stack,
            publishedAt: values.publishedAt,
            sourcePublishedAt: sql`coalesce(${values.sourcePublishedAt}, ${jobs.sourcePublishedAt})`,
            url: values.url,
            applyUrl: values.applyUrl,
            contactEmail: sql`coalesce(${values.contactEmail}, ${jobs.contactEmail})`,
            contactSubject: sql`coalesce(${values.contactSubject}, ${jobs.contactSubject})`,
            description: values.description,
            lastSeenAt: now,
            status: "active",
            updatedAt: now,
          },
        });
      });
      await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
      batch.forEach(entry => existing.has(entry.fp) ? updated++ : inserted++);
      await db.update(importRuns).set({ inserted, updated, duplicates: duplicateRows }).where(eq(importRuns.id, runId));
    }

    await db.update(importRuns).set({ status: "completed", inserted, updated, duplicates: duplicateRows, finishedAt: new Date() }).where(eq(importRuns.id, runId));
    return NextResponse.json({ ok: true, runId, received: items.length, accepted: entries.length, inserted, updated, duplicates: duplicateRows, errors: 0 });
  } catch {
    await db.update(importRuns).set({ status: "failed", inserted, updated, duplicates: duplicateRows, errors: 1, finishedAt: new Date() }).where(eq(importRuns.id, runId)).catch(() => undefined);
    return NextResponse.json({ error: "A importação foi interrompida. Reenvie o mesmo arquivo para concluir as vagas pendentes.", runId, inserted, updated }, { status: 500 });
  }
}
