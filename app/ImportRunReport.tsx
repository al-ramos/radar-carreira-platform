"use client";

import { useEffect, useState } from "react";

type Job = { id: string; company: string; title: string; location: string | null; workMode: string | null; outcome: "inserted" | "updated" | "duplicate"; receivedAt: string };
type Report = {
  run: { id: string; source: string; channel: string; status: "running" | "completed" | "failed"; received: number; inserted: number; updated: number; duplicates: number; errors: number; startedAt: string; finishedAt: string | null };
  intake: { traceId: string | null; valid: number | null; invalid: number; invalidReasons: Record<string, number>; rejectedProfile: number; accepted: number | null; profileRule: string | null } | null;
  error: string | null;
  jobs: Job[];
};

const channelLabel: Record<Report["run"]["channel"], string> = { extension: "Extensão", email: "E-mail", connector: "Coleta agendada", file: "Arquivo", api: "API" };
const outcomeLabel: Record<Job["outcome"], string> = { inserted: "Nova", updated: "Atualizada", duplicate: "Duplicada" };
const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));

export default function ImportRunReport({ runId, close }: { runId: string; close: () => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState("Carregando relatório…");
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState<"all" | Job["outcome"]>("all");

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

  const filteredJobs = report?.jobs.filter(job => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    const matchesSearch = !term || [job.title, job.company, job.location, job.workMode].some(value => value?.toLocaleLowerCase("pt-BR").includes(term));
    return matchesSearch && (outcome === "all" || job.outcome === outcome);
  }) ?? [];
  const sourceNeedsAttention = Boolean(report && (report.run.status === "failed" || report.run.errors > 0));

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
        <div className={`import-run-source-context${sourceNeedsAttention ? " needs-attention" : ""}`}>
          <div><small>Fonte desta execução</small><strong>{report.run.source}</strong></div>
          <p>{sourceNeedsAttention ? "Esta execução requer atenção: consulte o detalhe e as vagas afetadas antes da próxima coleta." : "Não há erros registrados nesta execução da fonte."}</p>
        </div>
        {report.intake && <div className="import-run-intake"><strong>Entrada da fonte — causas registradas</strong><p>{report.intake.valid === null ? "Execução antiga: o detalhamento de entrada não foi registrado." : `${report.run.received} recebida${report.run.received === 1 ? "" : "s"} · ${report.intake.valid} válida${report.intake.valid === 1 ? "" : "s"} · ${report.intake.accepted ?? report.run.inserted + report.run.updated} aceita${(report.intake.accepted ?? report.run.inserted + report.run.updated) === 1 ? "" : "s"} pelo Radar.`}</p>{report.intake.traceId && <p className="import-run-profile-rule">Referência operacional: <code>{report.intake.traceId}</code></p>}<dl className="import-run-reasons"><div><dt>Recebidas</dt><dd>Vagas enviadas pela extensão para esta execução.</dd></div><div><dt>Válidas</dt><dd>Passaram pela validação de campos obrigatórios e formato.</dd></div><div><dt>Aceitas</dt><dd>Entraram no Radar após validação e remoção de repetidas no mesmo lote.</dd></div><div><dt>Novas / atualizadas</dt><dd>Nova não existia pelo identificador; atualizada já existia e teve os dados renovados.</dd></div>{report.intake.invalid > 0 && <div><dt>Não entraram ({report.intake.invalid})</dt><dd>Foram recusadas por dados inválidos; os motivos estão abaixo.</dd></div>}{report.intake.rejectedProfile > 0 && <div><dt>Rejeitadas pelo perfil ({report.intake.rejectedProfile})</dt><dd>{report.intake.profileRule ?? "Não atenderam à regra obrigatória do perfil."}</dd></div>}</dl>{report.intake.rejectedProfile === 0 && report.intake.profileRule && <p className="import-run-profile-rule">Perfil: {report.intake.profileRule}</p>}{Object.keys(report.intake.invalidReasons).length > 0 && <ul>{Object.entries(report.intake.invalidReasons).map(([reason, count]) => <li key={reason}>{count} · {reason}</li>)}</ul>}</div>}
        {report.error && <div className="import-run-error"><strong>Detalhe da falha</strong><p>{report.error}</p></div>}
        <div className="import-run-jobs-head"><div><h3>Vagas afetadas</h3><p>{filteredJobs.length === report.jobs.length ? (report.jobs.length === 500 ? "Mostrando as 500 mais recentes" : `${report.jobs.length} vaga${report.jobs.length === 1 ? "" : "s"} registrada${report.jobs.length === 1 ? "" : "s"} nesta execução`) : `${filteredJobs.length} de ${report.jobs.length} vagas encontradas`}</p></div>{report.run.finishedAt && <small>Concluída em {formatDate(report.run.finishedAt)}</small>}</div>
        <div className="import-run-research" aria-label="Pesquisar no log da importação">
          <label>Pesquisar no log<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Vaga, empresa, local ou modalidade" /></label>
          <label>Resultado<select value={outcome} onChange={event => setOutcome(event.target.value as "all" | Job["outcome"])}><option value="all">Todos</option><option value="inserted">Novas</option><option value="updated">Atualizadas</option><option value="duplicate">Duplicadas</option></select></label>
        </div>
        <div className="import-run-jobs">
          {report.jobs.length === 0 ? <p>Nenhuma vaga foi gravada nesta execução.</p> : filteredJobs.length === 0 ? <p>Nenhuma vaga corresponde à pesquisa.</p> : filteredJobs.map(job => <article key={job.id}><span className={`import-run-outcome ${job.outcome}`}>{outcomeLabel[job.outcome]}</span><div><strong>{job.title}</strong><p>{job.company}{job.location ? ` · ${job.location}` : ""}{job.workMode ? ` · ${job.workMode}` : ""}</p></div><time>{formatDate(job.receivedAt)}</time></article>)}
        </div>
      </>}
    </section>
  </div>;
}
