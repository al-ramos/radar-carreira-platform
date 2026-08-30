"use client";

import { useEffect, useState } from "react";

type Operation = { id: string; flow: "importação" | "triagem"; label: string; status: string; startedAt: string; total: number; completed: number; failed: number; error: string | null };
type PerformanceMetric = { name: string; label: string; unit: "ms" | "score" | "bytes"; p75: number; p95: number; count: number; rating: "good" | "warning" | "poor" };
type PerformanceWindow = { id: "24h" | "7d"; label: string; sampleCount: number; metrics: PerformanceMetric[] };
type Data = {
  status: "healthy" | "warning" | "attention";
  responseMs: number;
  summary: { sources: number; enabled: number; active: number; failures: number; lastSuccess: string | null };
  performance: { sampled: boolean; sampleRate: number; retentionDays: number; lastSample: string | null; windows: PerformanceWindow[] };
  alerts: Array<{ level: "warning" | "error"; message: string; action: string }>;
  schedules: Array<{ id: string; label: string; cron: string | null; reason: string | null; heartbeat: { status: string; updatedAt: string; error: string | null } | null }>;
  sources: Array<{ id: string; name: string; provider: string; collectionMode: "pull" | "push"; enabled: boolean; lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null; consecutiveFailures: number; stale: boolean }>;
  operations: Operation[];
};

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "Nunca";

function formatMetric(value: number, unit: PerformanceMetric["unit"]) {
  if (unit === "score") return value.toFixed(3);
  if (unit === "bytes") return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${Math.round(value / 1_000)} KB`;
  return `${Math.round(value)} ms`;
}

export default function Monitoring({ close }: { close: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("Executando diagnóstico…");
  const [flow, setFlow] = useState<"all" | Operation["flow"]>("all");
  const [performancePeriod, setPerformancePeriod] = useState<PerformanceWindow["id"]>("24h");

  useEffect(() => {
    fetch("/api/admin/monitor")
      .then(async (response) => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data: responseData }) => {
        if (ok) { setData(responseData); setMessage(""); }
        else setMessage("Acesso exclusivo para administradores.");
      })
      .catch(() => setMessage("Não foi possível carregar o diagnóstico."));
  }, []);

  const operations = data?.operations.filter((item) => flow === "all" || item.flow === flow) ?? [];
  const performance = data?.performance.windows.find((window) => window.id === performancePeriod) ?? data?.performance.windows[0];

  return <div className="modal-backdrop" onClick={close}>
    <section className="modal monitor-modal" onClick={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={close}>×</button>
      <p className="eyebrow">CENTRO OPERACIONAL</p>
      <div className="monitor-title">
        <div><h2>Saúde do portal</h2><p>Execuções, agenda e desempenho real em um único lugar.</p></div>
        {data && <span className={data.status}>{data.status === "healthy" ? "Tudo saudável" : "Requer atenção"}</span>}
      </div>
      {message && <div className="notice">{message}</div>}
      {data && <>
        <div className="monitor-cards">
          <article><small>Banco de dados</small><strong>Conectado</strong><span>{data.responseMs} ms</span></article>
          <article><small>Fontes ativas</small><strong>{data.summary.enabled}/{data.summary.sources}</strong><span>monitoradas</span></article>
          <article><small>Falhas</small><strong>{data.summary.failures}</strong><span>execuções recentes</span></article>
          <article><small>Último sucesso</small><strong>{formatDate(data.summary.lastSuccess)}</strong><span>{data.summary.active} vagas ativas</span></article>
        </div>

        <section className="monitor-performance">
          <div className="monitor-section-heading">
            <div><h3>Desempenho percebido</h3><p>Percentis calculados com amostragem anônima de {Math.round(data.performance.sampleRate * 100)}% das sessões.</p></div>
            <select value={performancePeriod} onChange={(event) => setPerformancePeriod(event.target.value as PerformanceWindow["id"])}>
              {data.performance.windows.map((window) => <option key={window.id} value={window.id}>{window.label}</option>)}
            </select>
          </div>
          {performance?.metrics.length ? <>
            <div className="monitor-performance-grid">
              {performance.metrics.map((metric) => <article key={metric.name} className={metric.rating}>
                <span><b>{metric.label}</b><small>{metric.count} amostras</small></span>
                <div><strong>{formatMetric(metric.p75, metric.unit)}</strong><small>p75</small></div>
                <div><strong>{formatMetric(metric.p95, metric.unit)}</strong><small>p95</small></div>
              </article>)}
            </div>
            <p className="monitor-performance-foot">Última amostra: {formatDate(data.performance.lastSample)} · retenção: {data.performance.retentionDays} dias.</p>
          </> : <p className="monitor-empty">Aguardando amostras reais. Os primeiros percentis aparecem após acessos autenticados ao Radar.</p>}
        </section>

        {data.alerts.length > 0 && <section className="monitor-alerts"><h3>Precisa de atenção</h3>{data.alerts.map((alert) => <article key={alert.message} className={alert.level}><span><b>{alert.message}</b><small>{alert.action}</small></span></article>)}</section>}
        <section className="monitor-alerts"><h3>Agenda das automações</h3>{data.schedules.map((schedule) => <article key={schedule.id}><span><b>{schedule.label}</b><small>{schedule.cron ?? schedule.reason} · última execução: {schedule.heartbeat ? `${schedule.heartbeat.status} às ${formatDate(schedule.heartbeat.updatedAt)}` : "ainda não registrada"}{schedule.heartbeat?.error && ` · ${schedule.heartbeat.error}`}</small></span></article>)}</section>
        <div className="monitor-grid">
          <section><h3>Fontes cadastradas</h3>{data.sources.map((source) => <div className="source-health" key={source.id}><i className={!source.enabled ? "off" : source.lastError || source.stale ? "warn" : "ok"}/><span><b>{source.name}</b><small>{source.collectionMode === "pull" ? `${source.provider} · último sucesso: ${formatDate(source.lastSuccessAt)}` : `Integração de entrada · última execução: ${formatDate(source.lastRunAt)}`}</small></span><em>{!source.enabled ? "Pausada" : source.lastError ? "Falhou" : source.stale ? "Atrasada" : "Saudável"}</em></div>)}</section>
          <section><div className="monitor-section-heading"><h3>Execuções recentes</h3><select value={flow} onChange={(event) => setFlow(event.target.value as typeof flow)}><option value="all">Todos</option><option value="importação">Importações</option><option value="triagem">Triagem</option></select></div>{operations.map((operation) => <div className="run-row" key={operation.id}><span><b>{operation.label}</b><small>{operation.flow} · {formatDate(operation.startedAt)}{operation.error && ` · ${operation.error}`}</small></span><em className={operation.status}>{operation.status}</em><strong>{operation.completed}/{operation.total} · {operation.failed} falhas</strong></div>)}</section>
        </div>
      </>}
    </section>
  </div>;
}
