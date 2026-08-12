import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../../db/index";
import { importRuns, jobSources, jobs } from "../../../../../db/schema";
import { normalizeImportedJobs } from "../../../../../lib/import-jobs";
import { fingerprint, recordedJobDate, type ImportedJob } from "../../../../../lib/jobs";

export const dynamic = "force-dynamic";

const WRITE_BATCH_SIZE = 50;
const LOOKUP_BATCH_SIZE = 100;

/**
 * Fontes "push" autorizadas a enviar vagas por este endpoint — cada extensão
 * de coleta corresponde a um sourceId aqui. Uma allowlist explícita evita
 * que qualquer valor na URL crie uma fonte nova sem passar antes pela tela
 * de administração (que gera a chave e o nome de exibição).
 */
const KNOWN_SOURCES: Record<string, string> = {
  "linkedin-extension": "Extensão LinkedIn",
  "apinfo-extension": "Extensão APinfo",
};

const digest = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};
const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { ...CORS_HEADERS, ...init?.headers } });

const chunks = <T,>(values: T[], size: number) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );

function valuesFor(sourceId: string, job: ImportedJob, now: Date) {
  return {
    id: crypto.randomUUID(),
    fingerprint: fingerprint(job),
    sourceId,
    externalId: job.externalId ?? null,
    company: job.company,
    title: job.title,
    seniority: job.seniority ?? null,
    workMode: job.workMode ?? null,
    location: job.location ?? null,
    stack: JSON.stringify(job.stack ?? []),
    publishedAt: recordedJobDate(job.publishedAt, now),
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

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const sourceName = KNOWN_SOURCES[sourceId];
  if (!sourceName) return json({ error: "Fonte de coleta desconhecida" }, { status: 404 });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Chave do coletor ausente" }, { status: 401 });

  const db = getDb();
  const source = (await db.select().from(jobSources).where(eq(jobSources.id, sourceId)).limit(1))[0];
  let config: { hash?: string; userId?: string } = {};
  try {
    config = source ? (JSON.parse(source.externalRef) as typeof config) : {};
  } catch {
    /* integração inválida */
  }
  if (!source || !source.enabled || !config.hash || config.hash !== (await digest(token)))
    return json({ error: "Chave do coletor inválida" }, { status: 401 });

  const payload = (await request.json().catch(() => null)) as { action?: string; jobs?: unknown[] } | null;
  if (payload?.action === "test") return json({ ok: true, connected: true });
  const items = normalizeImportedJobs(Array.isArray(payload?.jobs) ? payload.jobs : []);
  if (!items.length) return json({ error: "Nenhuma vaga válida recebida" }, { status: 400 });
  if (items.length > 2000) return json({ error: "O limite é de 2.000 vagas por envio" }, { status: 400 });

  const entries = [...new Map(items.map((job) => [fingerprint(job), job])).entries()].map(([fp, job]) => ({
    fp,
    job,
  }));
  const duplicateRows = items.length - entries.length;
  const runId = crypto.randomUUID();
  const startedAt = new Date();
  await db.insert(importRuns).values({
    id: runId,
    source: sourceName,
    status: "running",
    received: items.length,
    duplicates: duplicateRows,
    actorUserId: config.userId ?? "collector",
    startedAt,
  });

  let inserted = 0;
  let updated = 0;
  try {
    const existing = new Set<string>();
    for (const batch of chunks(entries.map((entry) => entry.fp), LOOKUP_BATCH_SIZE)) {
      const rows = await db.select({ fingerprint: jobs.fingerprint }).from(jobs).where(inArray(jobs.fingerprint, batch));
      rows.forEach((row) => existing.add(row.fingerprint));
    }

    for (const batch of chunks(entries, WRITE_BATCH_SIZE)) {
      const now = new Date();
      const statements = batch.map(({ job }) => {
        const values = valuesFor(sourceId, job, now);
        return db.insert(jobs).values(values).onConflictDoUpdate({
          target: jobs.fingerprint,
          set: {
            sourceId,
            externalId: values.externalId,
            company: values.company,
            title: values.title,
            seniority: values.seniority,
            workMode: values.workMode,
            location: values.location,
            stack: values.stack,
            publishedAt: values.publishedAt,
            url: values.url,
            applyUrl: values.applyUrl,
            // COALESCE: uma recoleta rotineira da listagem não traz contato
            // (só a captura manual do e-mail traz). Sem isso, reenviar a
            // mesma vaga sem contato apagaria um e-mail já salvo antes.
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
      batch.forEach((entry) => (existing.has(entry.fp) ? updated++ : inserted++));
      await db.update(importRuns).set({ inserted, updated, duplicates: duplicateRows }).where(eq(importRuns.id, runId));
    }

    await db
      .update(importRuns)
      .set({ status: "completed", inserted, updated, duplicates: duplicateRows, finishedAt: new Date() })
      .where(eq(importRuns.id, runId));
    await db.update(jobSources).set({ lastRunAt: new Date() }).where(eq(jobSources.id, sourceId));
    return json({ ok: true, accepted: entries.length, received: items.length, duplicates: duplicateRows, rejected: 0, inserted, updated });
  } catch {
    await db
      .update(importRuns)
      .set({ status: "failed", inserted, updated, duplicates: duplicateRows, errors: 1, finishedAt: new Date() })
      .where(eq(importRuns.id, runId))
      .catch(() => undefined);
    return json(
      { error: "A importação foi interrompida. Reenvie o mesmo lote para concluir as vagas pendentes.", runId, inserted, updated },
      { status: 500 },
    );
  }
}
