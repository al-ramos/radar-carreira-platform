import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../../../../db/index";
import { importRuns, jobSources, jobs, profiles } from "../../../../../db/schema";
import { filterImportedJobsByProfile } from "../../../../../lib/collector-profile-filter";
import { normalizeImportedJobsWithDiagnostics } from "../../../../../lib/import-jobs";
import { fingerprint, recordedJobDate, sourcePublishedJobDate, type ImportedJob } from "../../../../../lib/jobs";
import { normalizeCareerRules } from "../../../../../lib/profile-options";
import { inferJobArea } from "../../../../../lib/job-area";
import { recordImportRunJobs } from "../../../../../lib/import-tracking";
import { notifyImportRun } from "../../../../../lib/notifications";
import { shouldArchiveImportedJob } from "../../../../../lib/job-archive-policy";

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

const count = (value: unknown) => Math.max(0, Math.min(1_000_000, Number(value) || 0));
const collectorRunId = (value: unknown) => {
  const candidate = String(value ?? "").trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(candidate) ? candidate : crypto.randomUUID();
};

type CollectorStatusPayload = {
  runId?: string;
  status?: "running" | "completed" | "failed" | "needs_attention" | "cancelled";
  received?: number;
  inserted?: number;
  updated?: number;
  duplicates?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};

type ImportDetails = {
  valid: number;
  invalid: number;
  invalidReasons: Record<string, number>;
  rejectedProfile: number;
  accepted: number;
  profileRule: string;
};

const serializeDetails = (details: ImportDetails) => JSON.stringify(details);

async function recordCollectorStatus(
  db: ReturnType<typeof getDb>,
  source: typeof jobSources.$inferSelect,
  sourceId: string,
  sourceName: string,
  actorUserId: string,
  statusPayload: CollectorStatusPayload,
) {
  const now = new Date();
  const runId = collectorRunId(statusPayload.runId);
  const reportedStatus = statusPayload.status ?? "running";
  const status = reportedStatus === "completed" ? "completed" : reportedStatus === "running" ? "running" : "failed";
  const startedAt = statusPayload.startedAt && !Number.isNaN(Date.parse(statusPayload.startedAt)) ? new Date(statusPayload.startedAt) : now;
  const finishedAt = status === "running" ? null : statusPayload.finishedAt && !Number.isNaN(Date.parse(statusPayload.finishedAt)) ? new Date(statusPayload.finishedAt) : now;
  const error = String(statusPayload.error || (reportedStatus === "cancelled" ? "Execução cancelada no navegador" : "")).slice(0, 300);
  const values = {
    id: runId,
    source: sourceName,
    sourceId,
    channel: "extension" as const,
    status,
    received: count(statusPayload.received),
    inserted: count(statusPayload.inserted),
    updated: count(statusPayload.updated),
    duplicates: count(statusPayload.duplicates),
    errors: status === "failed" ? 1 : 0,
    details: null,
    actorUserId,
    startedAt,
    finishedAt,
  };
  await db.insert(importRuns).values(values).onConflictDoUpdate({
    target: importRuns.id,
    set: {
      status: values.status,
      received: values.received,
      inserted: values.inserted,
      updated: values.updated,
      duplicates: values.duplicates,
      errors: values.errors,
      details: values.details,
      finishedAt: values.finishedAt,
    },
  });
  if (status === "running") {
    await db.update(jobSources).set({ lastAttemptAt: now }).where(eq(jobSources.id, sourceId));
  } else if (status === "completed") {
    await db.update(jobSources).set({ lastRunAt: now, lastSuccessAt: now, lastError: null, consecutiveFailures: 0 }).where(eq(jobSources.id, sourceId));
    await notifyImportRun(db, { runId, source: sourceName, status: "completed", received: values.received, inserted: values.inserted, updated: values.updated, duplicates: values.duplicates }).catch(() => undefined);
  } else {
    await db.update(jobSources).set({ lastRunAt: now, lastError: error || `Execução ${reportedStatus}`, consecutiveFailures: source.consecutiveFailures + 1 }).where(eq(jobSources.id, sourceId));
    await notifyImportRun(db, { runId, source: sourceName, status: "failed", received: values.received, inserted: values.inserted, updated: values.updated, duplicates: values.duplicates, error: error || `Execução ${reportedStatus}` }).catch(() => undefined);
  }
  return { runId, status: reportedStatus, recorded: true };
}

function valuesFor(sourceId: string, job: ImportedJob, now: Date) {
  const sourcePublishedAt = sourcePublishedJobDate(job.publishedAt);
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
    status: shouldArchiveImportedJob(sourcePublishedAt, now) ? "archived" as const : "active" as const,
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

  const payload = (await request.json().catch(() => null)) as { action?: string; runId?: string; run?: CollectorStatusPayload; jobs?: unknown[] } | null;
  if (payload?.action === "test") return json({ ok: true, connected: true });
  if (payload?.action === "status") {
    return json({ ok: true, ...(await recordCollectorStatus(db, source, sourceId, sourceName, config.userId ?? "collector", payload.run ?? {})) });
  }
  const rawItems = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const input = normalizeImportedJobsWithDiagnostics(rawItems);
  const items = input.items;
  if (!items.length) return json({ error: "Nenhuma vaga válida recebida", received: rawItems.length, invalid: input.rejected, invalidReasons: input.reasons }, { status: 400 });
  if (items.length > 2000) return json({ error: "O limite é de 2.000 vagas por envio" }, { status: 400 });

  const profile = sourceId === "linkedin-extension" && config.userId
    ? (await db.select({ careerRules: profiles.careerRules }).from(profiles).where(eq(profiles.userId, config.userId)).limit(1))[0]
    : undefined;
  const careerRules = normalizeCareerRules(profile?.careerRules);
  const filtered = filterImportedJobsByProfile(items, {
    requiredStacks: sourceId === "linkedin-extension" ? careerRules.coreStack : [],
    stackMatchMode: careerRules.coreStackMatchMode,
  });
  const entries = [...new Map(filtered.accepted.map((job) => [fingerprint(job), job])).entries()].map(([fp, job]) => ({
    fp,
    job,
  }));
  const duplicateRows = filtered.accepted.length - entries.length;
  const importDetails: ImportDetails = {
    valid: items.length,
    invalid: input.rejected,
    invalidReasons: input.reasons,
    rejectedProfile: filtered.rejected,
    accepted: entries.length,
    profileRule: filtered.requiredStacks.length
      ? `Exige ${filtered.stackMatchMode === "all" ? "todas" : "alguma"} das stacks obrigatórias: ${filtered.requiredStacks.join(", ")}.`
      : "Esta fonte não aplica filtro de stack obrigatório no Radar.",
  };
  const runId = collectorRunId(payload?.runId);
  const startedAt = new Date();
  await db.insert(importRuns).values({
    id: runId,
    source: sourceName,
    sourceId,
    channel: "extension",
    status: "running",
    received: rawItems.length,
    duplicates: duplicateRows,
    details: serializeDetails(importDetails),
    actorUserId: config.userId ?? "collector",
    startedAt,
  }).onConflictDoUpdate({
    target: importRuns.id,
    set: { status: "running", received: rawItems.length, duplicates: duplicateRows, details: serializeDetails(importDetails), errors: 0, finishedAt: null },
  });

  let inserted = 0;
  let updated = 0;
  try {
    if (!entries.length) {
      await db.update(importRuns).set({ status: "completed", details: serializeDetails(importDetails), finishedAt: new Date() }).where(eq(importRuns.id, runId));
      const finishedAt = new Date();
      await db.update(jobSources).set({ lastRunAt: finishedAt, lastSuccessAt: finishedAt, lastError: null, consecutiveFailures: 0 }).where(eq(jobSources.id, sourceId));
      await notifyImportRun(db, { runId, source: sourceName, status: "completed", received: rawItems.length, valid: items.length, invalid: input.rejected, invalidReasons: input.reasons, rejectedProfile: filtered.rejected, inserted: 0, updated: 0, duplicates: 0 }).catch(() => undefined);
      return json({ ok: true, runId, accepted: 0, received: rawItems.length, valid: items.length, invalid: input.rejected, invalidReasons: input.reasons, duplicates: 0, rejected: filtered.rejected, inserted: 0, updated: 0, requiredStacks: filtered.requiredStacks, stackMatchMode: filtered.stackMatchMode, message: "Nenhuma vaga atende ao perfil de stacks obrigatórias" });
    }
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
            ingestionChannel: values.ingestionChannel,
            roleArea: values.roleArea,
            publishedAt: values.publishedAt,
            // Dentro de `sql```, o encoder `timestamp_ms` da coluna não é
            // aplicado ao parâmetro interpolado. O D1 aceita o epoch em
            // milissegundos, mas rejeita uma instância JavaScript `Date`.
            sourcePublishedAt: sql`coalesce(${values.sourcePublishedAt?.getTime() ?? null}, ${jobs.sourcePublishedAt})`,
            url: values.url,
            applyUrl: values.applyUrl,
            // COALESCE: uma recoleta rotineira da listagem não traz contato
            // (só a captura manual do e-mail traz). Sem isso, reenviar a
            // mesma vaga sem contato apagaria um e-mail já salvo antes.
            contactEmail: sql`coalesce(${values.contactEmail}, ${jobs.contactEmail})`,
            contactSubject: sql`coalesce(${values.contactSubject}, ${jobs.contactSubject})`,
            description: values.description,
            lastSeenAt: now,
            status: values.status === "archived" ? "archived" : sql`case when ${jobs.status} = 'archived' then 'archived' else 'active' end`,
            updatedAt: now,
          },
        });
      });
      await db.batch(statements as [typeof statements[number], ...typeof statements[number][]]);
      await recordImportRunJobs(db, runId, batch.map(entry => entry.fp), existing, now);
      batch.forEach((entry) => (existing.has(entry.fp) ? updated++ : inserted++));
      await db.update(importRuns).set({ inserted, updated, duplicates: duplicateRows }).where(eq(importRuns.id, runId));
    }

    await db
      .update(importRuns)
      .set({ status: "completed", inserted, updated, duplicates: duplicateRows, details: serializeDetails(importDetails), finishedAt: new Date() })
      .where(eq(importRuns.id, runId));
    const finishedAt = new Date();
    await db.update(jobSources).set({ lastRunAt: finishedAt, lastSuccessAt: finishedAt, lastError: null, consecutiveFailures: 0 }).where(eq(jobSources.id, sourceId));
    await notifyImportRun(db, { runId, source: sourceName, status: "completed", received: rawItems.length, valid: items.length, invalid: input.rejected, invalidReasons: input.reasons, rejectedProfile: filtered.rejected, inserted, updated, duplicates: duplicateRows }).catch(() => undefined);
    return json({ ok: true, runId, accepted: filtered.accepted.length, received: rawItems.length, valid: items.length, invalid: input.rejected, invalidReasons: input.reasons, duplicates: duplicateRows, rejected: filtered.rejected, inserted, updated, requiredStacks: filtered.requiredStacks, stackMatchMode: filtered.stackMatchMode });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Falha desconhecida durante a gravação";
    await db
      .update(importRuns)
      .set({ status: "failed", inserted, updated, duplicates: duplicateRows, errors: 1, details: serializeDetails(importDetails), finishedAt: new Date() })
      .where(eq(importRuns.id, runId))
      .catch(() => undefined);
    await notifyImportRun(db, { runId, source: sourceName, status: "failed", received: rawItems.length, valid: items.length, invalid: input.rejected, invalidReasons: input.reasons, rejectedProfile: filtered.rejected, inserted, updated, duplicates: duplicateRows, error: detail.slice(0, 300) }).catch(() => undefined);
    return json(
      { error: "A importação foi interrompida. Reenvie o mesmo lote para concluir as vagas pendentes.", runId, inserted, updated },
      { status: 500 },
    );
  }
}
