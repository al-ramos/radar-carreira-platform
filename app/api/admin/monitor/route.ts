import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { can } from "../../../../lib/rbac";
import { getDb } from "../../../../db/index";
import { automationHeartbeats, databaseFailures, importRuns, jobSources, jobs, triageBatchItems, triageBatches } from "../../../../db/schema";
import { trackDatabaseOperation } from "../../../../lib/database-failure";

export const dynamic = "force-dynamic";

async function admin() {
  const u = await getChatGPTUser();
  if (!u) return null;
  return await can(u, "monitor.view") ? u : null;
}

const safeError = (value: string | null) => value?.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail redigido]").replace(/https?:\/\/\S+/g, "[URL redigida]").replace(/\s+/g, " ").trim().slice(0, 300) ?? null;

export async function GET() {
  if (!await admin()) return NextResponse.json({ error: "Acesso restrito a usuários autenticados" }, { status: 403 });

  const started = Date.now();
  const db = getDb();
  const [sources, importRows, batches, batchItems, jobRows, heartbeats, dbFailures] = await trackDatabaseOperation("monitor.read", "O Centro Operacional não conseguiu consultar o D1.", () => Promise.all([
    db.select().from(jobSources),
    db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(20),
    db.select().from(triageBatches).orderBy(desc(triageBatches.createdAt)).limit(20),
    db.select().from(triageBatchItems),
    db.select({ status: jobs.status }).from(jobs),
    db.select().from(automationHeartbeats),
    db.select().from(databaseFailures).orderBy(desc(databaseFailures.occurredAt)).limit(10),
  ]));

  const now = Date.now();
  const staleSources = sources.filter((source) => source.enabled && source.collectionMode === "pull" && (!source.lastRunAt || source.lastRunAt.getTime() < now - 48 * 36e5));
  const itemCounts = new Map<string, { total: number; completed: number; failed: number }>();
  for (const item of batchItems) {
    const count = itemCounts.get(item.batchId) ?? { total: 0, completed: 0, failed: 0 };
    count.total += 1;
    if (item.status === "completed") count.completed += 1;
    if (item.status === "failed") count.failed += 1;
    itemCounts.set(item.batchId, count);
  }

  const operations = [
    ...importRows.map((run) => ({ id: `import-${run.id}`, flow: "importação" as const, label: run.source, status: run.status, startedAt: run.startedAt, completedAt: run.finishedAt, total: run.received, completed: run.inserted + run.updated, failed: run.errors, error: safeError(run.details) })),
    ...batches.map((batch) => {
      const count = itemCounts.get(batch.id) ?? { total: 0, completed: 0, failed: 0 };
      return { id: `triage-${batch.id}`, flow: "triagem" as const, label: batch.trigger === "scheduled" ? "Triagem agendada" : "Triagem manual", status: batch.status, startedAt: batch.startedAt ?? batch.createdAt, completedAt: batch.completedAt, total: count.total, completed: count.completed, failed: count.failed, error: safeError(batch.error) };
    }),
  ].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, 20);
  const failedOperations = operations.filter((operation) => operation.status === "failed" || operation.failed > 0);
  const alerts = [
    ...staleSources.map((source) => ({ level: "warning" as const, message: `${source.name}: coleta atrasada há mais de 48 horas.`, action: "Verificar fonte e agenda." })),
    ...sources.filter((source) => source.enabled && source.lastError).map((source) => ({ level: "error" as const, message: `${source.name}: ${safeError(source.lastError)}`, action: "Reexecutar ou corrigir a fonte." })),
    ...failedOperations.slice(0, 5).map((operation) => ({ level: "error" as const, message: `${operation.label}: execução com falha.`, action: operation.flow === "triagem" ? "Abrir Triagem e retomar itens pendentes." : "Consultar detalhe da importação." })),
    ...dbFailures.slice(0, 3).map((failure) => ({ level: "error" as const, message: `D1: ${safeError(failure.error) ?? "falha registrada"}`, action: `${failure.impact} (${failure.operation})` })),
  ];
  const status = alerts.some((alert) => alert.level === "error") ? "attention" : alerts.length ? "warning" : "healthy";

  const schedules = [{ id: "collect", label: "Coleta de fontes", cron: "Dias úteis, 08:15 (Brasília)" }, { id: "enrich", label: "Enriquecimento", cron: "Após a coleta" }, { id: "lifecycle", label: "Ciclo de vida", cron: "Após a coleta" }, { id: "revalidate", label: "Revalidação de fontes", cron: "Segundas, 03:00 (Brasília)" }, { id: "email-import", label: "Importação Gmail", cron: null }].map((schedule) => ({ ...schedule, heartbeat: heartbeats.find((heartbeat) => heartbeat.id === schedule.id) ?? null, reason: schedule.cron ? null : "Executada pelo conector Gmail; não há agenda declarada no Radar." }));
  return NextResponse.json({ status, responseMs: Date.now() - started, summary: { sources: sources.length, enabled: sources.filter((source) => source.enabled).length, active: jobRows.filter((job) => job.status === "active").length, closed: jobRows.filter((job) => job.status !== "active").length, failures: failedOperations.length + dbFailures.length, lastSuccess: operations.find((operation) => operation.status === "completed")?.completedAt ?? null }, alerts, schedules, databaseFailures: dbFailures.map((failure) => ({ ...failure, error: safeError(failure.error), impact: safeError(failure.impact) })), sources: sources.map((source) => ({ ...source, lastError: safeError(source.lastError), stale: staleSources.some((item) => item.id === source.id) })), operations });
}
