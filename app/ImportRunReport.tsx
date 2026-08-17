"use client";

import { useEffect, useState } from "react";

type Job = { id: string; company: string; title: string; location: string | null; workMode: string | null; outcome: "inserted" | "updated" | "duplicate"; receivedAt: string };
type Report = {
  run: { id: string; source: string; channel: string; status: "running" | "completed" | "failed"; received: number; inserted: number; updated: number; duplicates: number; errors: number; startedAt: string; finishedAt: string | null };
  error: string | null;
  jobs: Job[];
};

const channelLabel: Record<Report["run"]["channel"], string> = { extension: "Extensão", email: "E-mail", connector: "Coleta agendada", file: "Arquivo", api: "API" };
const outcomeLabel: Record<Job["outcome"], string> = { inserted: "Nova", updated: "Atualizada", duplicate: "Duplicada" };
const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export default function ImportRunReport({ runId, close }: { runId: string; close: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState("Carregando relatório…");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/imports/${encodeURIComponent(runId)}`, { signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await response.json() as Report & { error?: string } }))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error ?? "Não foi possível carregar este relatório.");
        setReport(data);
        setMessage("");
      })
      .catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Não foi possível carregar este relatório."); });
    return () => controller.abort();
  }, [runId]);

  return <div className="modal-backdrop" onClick={close}>
    <section className="modal import-run-report" onClick={event => event.stopPropagation()} aria-labelledby="import-run-report-title">
      <button type="button" className="modal-close" onClick={close} aria-label="Fechar relatório">×</button>
      <p className="eyebrow">RELATÓRIO DE IMPORTAÇÃO</p>
      {message && <div className="notice">{message}</div>}
      {report && <>
        <div className="import-run-report-title">
          <div><h2 id="import-run-report-title">{report.run.source}</h2><p>{channelLabel[report.run.channel] ?? report.run.channel} · iniciada em {formatDate(report.run.startedAt)}</p></div>
          <span className={`import-run-status ${report.run.status}`}>{report.run.status === "completed" ? "Concluída" : report.run.status === "failed" ? "Falhou" : "Em andamento"}</span>
        </div>
        <div className="import-run-metrics">
          <article><strong>{report.run.received.toLocaleString("pt-BR")}</strong><span>recebidas</span></article>
          <article><strong>{report.run.inserted.toLocaleString("pt-BR")}</strong><span>novas</span></article>
          <article><strong>{report.run.updated.toLocaleString("pt-BR")}</strong><span>atualizadas</span></article>
          <article><strong>{report.run.duplicates.toLocaleString("pt-BR")}</strong><span>duplicadas</span></article>
          <article className={report.run.errors ? "has-error" : ""}><strong>{report.run.errors.toLocaleString("pt-BR")}</strong><span>erros</span></article>
        </div>
        {report.error && <div className="import-run-error"><strong>Detalhe da falha</strong><p>{report.error}</p></div>}
        <div className="import-run-jobs-head"><div><h3>Vagas afetadas</h3><p>{report.jobs.length === 500 ? "Mostrando as 500 mais recentes" : `${report.jobs.length} vaga${report.jobs.length === 1 ? "" : "s"} registrada${report.jobs.length === 1 ? "" : "s"} nesta execução`}</p></div>{report.run.finishedAt && <small>Concluída em {formatDate(report.run.finishedAt)}</small>}</div>
        <div className="import-run-jobs">
          {report.jobs.length === 0 ? <p>Nenhuma vaga foi gravada nesta execução.</p> : report.jobs.map(job => <article key={job.id}><span className={`import-run-outcome ${job.outcome}`}>{outcomeLabel[job.outcome]}</span><div><strong>{job.title}</strong><p>{job.company}{job.location ? ` · ${job.location}` : ""}{job.workMode ? ` · ${job.workMode}` : ""}</p></div><time>{formatDate(job.receivedAt)}</time></article>)}
        </div>
      </>}
    </section>
  </div>;
}
