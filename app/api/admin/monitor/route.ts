import { count, desc, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { can } from "../../../../lib/rbac";
import { getDb } from "../../../../db/index";
import { automationHeartbeats, importRuns, jobSources, jobs, performanceSamples, triageBatchItems, triageBatches } from "../../../../db/schema";

export const dynamic = "force-dynamic";

async function admin() {
  const u = await getChatGPTUser();
  if (!u) return null;
  return await can(u, "monitor.view") ? u : null;
}

const safeError = (value: string | null) => value
  ?.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail redigido]")
  .replace(/https?:\/\/\S+/g, "[URL redigida]")
  .replace(/\s+/g, " ").trim().slice(0, 300) ?? null;

const metricDefinitions: Record<string, { label: string; unit: "ms" | "score" | "bytes"; good: number; poor: number }> = {
  ttfb: { label: "TTFB", unit: "ms", good: 800, poor: 1_800 },
  fcp: { label: "FCP", unit: "ms", good: 1_800, poor: 3_000 },
  lcp: { label: "LCP", unit: "ms", good: 2_500, poor: 4_000 },
  cls: { label: "CLS", unit: "score", good: 0.1, poor: 0.25 },
  inp: { label: "INP", unit: "ms", good: 200, poor: 500 },
  jobs_api_duration: { label: "Lista no navegador", unit: "ms", good: 1_500, poor: 3_000 },
  jobs_api_server: { label: "Lista no Worker/D1", unit: "ms", good: 1_000, poor: 2_000 },
  jobs_api_bytes: { label: "Payload da lista", unit: "bytes", good: 250_000, poor: 1_000_000 },
  jobs_meta_duration: { label: "Filtros no navegador", unit: "ms", good: 800, poor: 1_500 },
  jobs_meta_server: { label: "Filtros no Worker/D1", unit: "ms", good: 500, poor: 1_000 },
  jobs_meta_bytes: { label: "Payload dos filtros", unit: "bytes", good: 100_000, poor: 500_000 },
};

function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function performanceWindow(rows: Array<{ metric: string; value: number; createdAt: Date }>, cutoff: number, id: "24h" | "7d", label: string) {
  const scoped = rows.filter((row) => row.createdAt.getTime() >= cutoff);
  const metrics = Object.entries(metricDefinitions).flatMap(([name, definition]) => {
    const values = scoped.filter((row) => row.metric === name).map((row) => row.value);
    const p75 = percentile(values, 0.75);
    const p95 = percentile(values, 0.95);
    if (p75 === null || p95 === null) return [];
    const rating = p75 <= definition.good ? "good" : p75 <= definition.poor ? "warning" : "poor";
    return [{ name, ...definition, p75, p95, count: values.length, rating }];
  });
  return { id, label, sampleCount: scoped.length, metrics };
}

export async function GET() {
  if (!await admin()) return NextResponse.json({ error: "Acesso restrito a usuários autenticados" }, { status: 403 });

  const started = Date.now();
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 36e5);
  const db = getDb();
  const [sources, importRows, batches, jobCountRows, heartbeats, performanceRows] = await Promise.all([
    db.select().from(jobSources),
    db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(20),
    db.select().from(triageBatches).orderBy(desc(triageBatches.createdAt)).limit(20),
    db.select({ status: jobs.status, total: count() }).from(jobs).groupBy(jobs.status),
    db.select().from(automationHeartbeats),
    db.select({ metric: performanceSamples.metric, value: performanceSamples.value, createdAt: performanceSamples.createdAt })
      .from(performanceSamples).where(gte(performanceSamples.createdAt, sevenDaysAgo))
      .orderBy(desc(performanceSamples.createdAt)).limit(5_000),
  ]);
  const batchIds = batches.map((batch) => batch.id);
  const batchItems = batchIds.length
    ? await db.select().from(triageBatchItems).where(inArray(triageBatchItems.batchId, batchIds))
    : [];

  const stalledManualItems = batchItems.filter((item) => {
    const batch = batches.find((candidate) => candidate.id === item.batchId);
    return batch?.trigger === "manual" && (item.status === "queued" || item.status === "processing") && item.updatedAt.getTime() < now - 2 * 60_000;
  });
  const staleSources = sources.filter((source) => source.enabled && source.collectionMode === "pull" && (!source.lastRunAt || source.lastRunAt.getTime() < now - 48 * 36e5));
  const itemCounts = new Map<string, { total: number; completed: number; failed: number }>();
  for (const item of batchItems) {
    const current = itemCounts.get(item.batchId) ?? { total: 0, completed: 0, failed: 0 };
    current.total += 1;
    if (item.status === "completed") current.completed += 1;
    if (item.status === "failed") current.failed += 1;
    itemCounts.set(item.batchId, current);
  }

  const operations = [
    ...importRows.map((run) => ({ id: `import-${run.id}`, flow: "importação" as const, label: run.source, status: run.status, startedAt: run.startedAt, completedAt: run.finishedAt, total: run.received, completed: run.inserted + run.updated, failed: run.errors, error: safeError(run.details) })),
    ...batches.map((batch) => {
      const totals = itemCounts.get(batch.id) ?? { total: 0, completed: 0, failed: 0 };
      return { id: `triage-${batch.id}`, flow: "triagem" as const, label: batch.trigger === "scheduled" ? "Triagem agendada" : "Triagem manual", status: batch.status, startedAt: batch.startedAt ?? batch.createdAt, completedAt: batch.completedAt, ...totals, error: safeError(batch.error) };
    }),
  ].sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime()).slice(0, 20);
  const failedOperations = operations.filter((operation) => operation.status === "failed" || operation.failed > 0);
  const windows = [
    performanceWindow(performanceRows, now - 24 * 36e5, "24h", "Últimas 24 horas"),
    performanceWindow(performanceRows, sevenDaysAgo.getTime(), "7d", "Últimos 7 dias"),
  ];
  const degradedMetrics = windows[0].metrics.filter((metric) => metric.rating === "poor");
  // Um batimento preso em "running" além da janela da própria automação não é
  // execução em andamento: é execução que nunca reportou fim. Sem esse limite,
  // "collect" ficou 9 horas com aparência saudável. O estado é derivado na
  // leitura — nada é reescrito, para não gastar cota do D1.
  const staleRunning = (schedule: { id: string; staleAfterMs: number }, beat: { status: string; updatedAt: Date } | null) =>
    Boolean(beat && beat.status === "running" && beat.updatedAt.getTime() < now - schedule.staleAfterMs);
  const HOUR = 36e5;
  const DECLARED_SCHEDULE_IDS = new Set([
    "collect", "enrich", "lifecycle", "revalidate", "triage-recovery",
    "triage-dispatch", "triage-backlog-sweep", "draft-monitor", "email-import", "gmail-drafts",
  ]);
  const schedules = [
    { id: "collect", label: "Coleta de fontes ATS", cron: "Dias úteis, 08:15 (Brasília)", staleAfterMs: 6 * HOUR },
    { id: "enrich", label: "Enriquecimento de vagas", cron: "Dias úteis, após a coleta", staleAfterMs: 6 * HOUR },
    { id: "lifecycle", label: "Ciclo de vida das vagas", cron: "Dias úteis, após o enriquecimento", staleAfterMs: 6 * HOUR },
    { id: "revalidate", label: "Revalidação de fontes", cron: "Segundas, 03:00 (Brasília)", staleAfterMs: 24 * HOUR },
    { id: "triage-recovery", label: "Recuperação da fila manual", cron: "A cada 15 minutos", staleAfterMs: HOUR },
    { id: "triage-dispatch", label: "Despacho da triagem", cron: "A cada 15 minutos", staleAfterMs: HOUR },
    { id: "triage-backlog-sweep", label: "Varredura do backlog de triagem", cron: "Uma vez por hora", staleAfterMs: 3 * HOUR },
    { id: "draft-monitor", label: "Observação da fila de rascunhos", cron: "Uma vez por hora", staleAfterMs: 3 * HOUR },
    { id: "email-import", label: "Importação Gmail", cron: null, staleAfterMs: 48 * HOUR },
    { id: "gmail-drafts", label: "Conector Gmail de rascunhos", cron: null, staleAfterMs: 48 * HOUR },
    // T2 — uma automação que grava batimento e não está declarada acima ainda
    // precisa aparecer. A lista fixa já escondeu três delas; derivar o resto
    // dos próprios batimentos impede que isso volte a acontecer em silêncio.
    ...heartbeats
      .filter((beat) => !DECLARED_SCHEDULE_IDS.has(beat.id))
      .map((beat) => ({ id: beat.id, label: beat.id, cron: null, staleAfterMs: 24 * HOUR })),
  ].map((schedule) => {
    const beat = heartbeats.find((heartbeat) => heartbeat.id === schedule.id) ?? null;
    const silentSinceMs = beat ? now - beat.updatedAt.getTime() : null;
    return {
      ...schedule,
      heartbeat: beat,
      stale: staleRunning(schedule, beat),
      silent: Boolean(beat && silentSinceMs !== null && silentSinceMs > schedule.staleAfterMs && beat.status !== "running"),
      declared: DECLARED_SCHEDULE_IDS.has(schedule.id),
      reason: beat
        ? DECLARED_SCHEDULE_IDS.has(schedule.id) ? null : "Automação não declarada no painel; identificada pelo batimento que ela grava."
        : schedule.cron
          ? "Sem execução registrada até agora."
          : "Executada pelo conector Gmail; sem execução registrada até agora.",
    };
  });
  const stuckSchedules = schedules.filter((schedule) => schedule.stale);
  const silentSchedules = schedules.filter((schedule) => schedule.silent);
  const alerts = [
    ...staleSources.map((source) => ({ level: "warning" as const, message: `${source.name}: coleta atrasada há mais de 48 horas.`, action: "Verificar fonte e agenda." })),
    ...sources.filter((source) => source.enabled && source.lastError).map((source) => ({ level: "error" as const, message: `${source.name}: ${safeError(source.lastError)}`, action: "Reexecutar ou corrigir a fonte." })),
    ...failedOperations.slice(0, 5).map((operation) => ({ level: "error" as const, message: `${operation.label}: execução com falha.`, action: operation.flow === "triagem" ? "Abrir Triagem e retomar itens pendentes." : "Consultar detalhe da importação." })),
    ...(stalledManualItems.length ? [{ level: "warning" as const, message: `${stalledManualItems.length} vaga(s) manuais sem progresso há mais de 2 minutos.`, action: "A recuperação automática reenfileira os itens; acompanhe o próximo ciclo." }] : []),
    ...degradedMetrics.map((metric) => ({ level: "warning" as const, message: `${metric.label}: p75 acima da faixa operacional.`, action: "Comparar com p95 e investigar regressão recente." })),
    ...stuckSchedules.map((schedule) => ({ level: "error" as const, message: `${schedule.label}: iniciada em ${schedule.heartbeat?.updatedAt.toISOString()} e sem conclusão registrada.`, action: "A execução não reportou fim; verifique o log do Worker e reexecute." })),
    ...silentSchedules.map((schedule) => ({ level: "warning" as const, message: `${schedule.label}: sem se reportar desde ${schedule.heartbeat?.updatedAt.toISOString()}.`, action: schedule.cron ? "Confirmar se a agenda continua ativa." : "Confirmar o gatilho do Apps Script na conta Google." })),
  ];
  const status = alerts.some((alert) => alert.level === "error") ? "attention" : alerts.length ? "warning" : "healthy";
  const totalForStatus = (statusName: string) => Number(jobCountRows.find((row) => row.status === statusName)?.total ?? 0);

  return NextResponse.json({
    status,
    responseMs: Date.now() - started,
    summary: {
      sources: sources.length, enabled: sources.filter((source) => source.enabled).length,
      active: totalForStatus("active"), closed: jobCountRows.filter((row) => row.status !== "active").reduce((sum, row) => sum + Number(row.total), 0),
      failures: failedOperations.length, lastSuccess: operations.find((operation) => operation.status === "completed")?.completedAt ?? null,
    },
    performance: { sampled: true, sampleRate: 0.1, retentionDays: 30, lastSample: performanceRows[0]?.createdAt ?? null, windows },
    alerts,
    schedules,
    sources: sources.map((source) => ({ ...source, lastError: safeError(source.lastError), stale: staleSources.some((item) => item.id === source.id) })),
    operations,
  });
}
