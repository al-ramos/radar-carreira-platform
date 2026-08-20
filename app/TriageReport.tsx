"use client";
import { useEffect, useState } from "react";
type Item = { jobId: string; veredito: string; motivo: string | null; processedAt: string; title: string; company: string; workMode: string | null; location: string | null; url: string };
type Data = { counts: Record<string, number>; total: number; items: Item[] };
type PilotResult = { batchId: string; processed: Array<{ jobId: string; title: string; company: string; reference: string | null; contactEligible: boolean; aiEligible: boolean; aiStatus: string; verdict: string; label: string; blocker: string | null }>; skipped: number; aiCompleted?: number };
type HistoryItem = { id: string; batchId: string; jobId: string; verdict: string; label: string; blocker: string | null; source: string; confidence: number; rows: string; processedAt: string; title: string; company: string; externalId: string | null; jobSource: string | null; workMode: string | null; location: string | null; sourcePublishedAt: string | null; receivedAt: string; url: string; contactEmail: string | null; hasValidContactEmail: boolean; draftStatus: "pending" | "drafted" | "failed" | "cancelled" | null; draftSubject: string; draftError: string | null; draftUpdatedAt: string | null; trigger: string };
type Batch = { id: string; trigger: "manual" | "scheduled" | "assistant"; scope: string; status: string; startedAt: string | null; completedAt: string | null; createdAt: string; error: string | null; total: number; completed: number; failed: number; eligible: number; eligibleWithoutContact: number; draftsPending: number; draftsReady: number; draftsFailed: number };
type Operational = { pendingDrafts: number; readyDrafts: number; failedDrafts: number; oldestPendingAt: string | null; alerts: Array<{ level: "warning" | "error"; message: string }> };
const rowClass: Record<string, string> = { "✅": "approved", "🟡": "partial", "❌": "rejected", "🔴": "rejected" };
export default function TriageReport({ close, sourceId, sourceLabel }: { close: () => void; sourceId?: string; sourceLabel?: string }) {
  const [message, setMessage] = useState("Carregando avaliações…"),
    [runningPilot, setRunningPilot] = useState(false),
    [queueingDrafts, setQueueingDrafts] = useState(false),
    [pilot, setPilot] = useState<PilotResult | null>(null),
    [batchSize, setBatchSize] = useState(10),
    [reprocess, setReprocess] = useState(false),
    [history, setHistory] = useState<HistoryItem[]>([]),
    [batches, setBatches] = useState<Batch[]>([]),
    [operational, setOperational] = useState<Operational | null>(null),
    [verdictFilter, setVerdictFilter] = useState("all"),
    [sourceFilter, setSourceFilter] = useState("all"),
    [draftFilter, setDraftFilter] = useState("all"),
    [jobSourceFilter, setJobSourceFilter] = useState("all"),
    [sortKey, setSortKey] = useState<"processedAt" | "company" | "title" | "verdict" | "draft">("processedAt"),
    [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc"),
    [historyPage, setHistoryPage] = useState(0);
  const loadHistory = () => fetch("/api/triage/history")
    .then(async (r) => ({ ok: r.ok, data: await r.json() as { items?: HistoryItem[]; batches?: Batch[]; operational?: Operational } }))
    .then(({ ok, data }) => { if (ok) { setHistory(data.items ?? []); setBatches(data.batches ?? []); setOperational(data.operational ?? null); } });
  useEffect(() => {
    void loadHistory();
  }, []);
  const date = (v: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));
  const latestScheduled = batches.find((batch) => batch.trigger === "scheduled");
  const latestByJob = new Map<string, HistoryItem>();
  for (const item of history) if (!latestByJob.has(item.jobId)) latestByJob.set(item.jobId, item);
  const currentAssessments = [...latestByJob.values()];
  const jobSources = [...new Set(currentAssessments.map((item) => item.jobSource).filter(Boolean))] as string[];
  const filteredHistory = currentAssessments.filter((item) => (verdictFilter === "all" || item.verdict === verdictFilter) && (sourceFilter === "all" || item.source === sourceFilter) && (draftFilter === "all" || item.draftStatus === draftFilter) && (jobSourceFilter === "all" || item.jobSource === jobSourceFilter));
  const sortHistory = (key: typeof sortKey) => {
    if (key === sortKey) setSortDirection((value) => value === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDirection("asc"); }
    setHistoryPage(0);
  };
  const orderedHistory = [...filteredHistory].sort((a, b) => {
    const fields = { processedAt: [a.processedAt, b.processedAt], company: [a.company, b.company], title: [a.title, b.title], verdict: [a.verdict, b.verdict], draft: [a.draftStatus ?? "", b.draftStatus ?? ""] } as const;
    return fields[sortKey][0].localeCompare(fields[sortKey][1], "pt-BR", { numeric: true }) * (sortDirection === "asc" ? 1 : -1);
  });
  const historyPageSize = 10;
  const visibleHistory = orderedHistory.slice(historyPage * historyPageSize, (historyPage + 1) * historyPageSize);
  const draftItems = history.filter((item) => item.draftStatus && ["pending", "drafted", "failed"].includes(item.draftStatus));
  const scheduledSummary = (batch: Batch) => {
    if (batch.total === 0) return "Nenhuma vaga nova pendente de avaliação foi encontrada para este dia.";
    if (batch.eligible === 0) return "Nenhuma vaga aderente ou provável foi encontrada neste lote.";
    if (batch.eligibleWithoutContact === batch.eligible) return "As vagas elegíveis continuam sem e-mail de contato válido; nenhum rascunho foi preparado.";
    return `${batch.eligible} vaga(s) elegível(is); somente as que têm contato válido podem gerar rascunho.`;
  };
  const runPilot = async () => {
    setRunningPilot(true);
    setMessage("Executando piloto determinístico de até 10 vagas…");
    try {
      const response = await fetch("/api/triage/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger: sourceId ? "gpt" : "portal", sourceId, batchSize, reprocess, aiMode: "ambiguous", createDrafts: false }),
      });
      const result = await response.json() as PilotResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir o piloto.");
      setPilot(result);
      setMessage(`Triagem concluída: ${result.processed.length} vagas registradas, ${result.aiCompleted ?? 0} refinada(s) por IA e ${result.skipped} já processada(s). Rascunhos continuam dependentes de contato válido.`);
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir o piloto.");
    } finally {
      setRunningPilot(false);
    }
  };
  const queueDrafts = async () => {
    setQueueingDrafts(true);
    setMessage("Verificando vagas elegíveis para a fila de rascunhos…");
    try {
      const response = await fetch("/api/triage/drafts/queue", { method: "POST" });
      const result = await response.json() as { error?: string; queued: number; noValidContact: number; outdated: number; alreadyPresent: number };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível preparar a fila de rascunhos.");
      setMessage(`Fila preparada: ${result.queued} vaga(s) elegível(is); ${result.noValidContact} sem e-mail válido; ${result.outdated} precisa(m) de nova avaliação; ${result.alreadyPresent} já estava(m) na fila. Nenhum e-mail foi criado ou enviado.`);
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível preparar a fila de rascunhos.");
    } finally {
      setQueueingDrafts(false);
    }
  };
  const retryFailedDrafts = async () => {
    setQueueingDrafts(true);
    try {
      const response = await fetch("/api/triage/drafts/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retryFailed" }) });
      const result = await response.json() as { error?: string; retried?: number };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível retomar os rascunhos.");
      setMessage(`${result.retried ?? 0} falha(s) de rascunho voltaram para a fila. O Gmail continuará criando somente rascunhos.`);
      void loadHistory();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível retomar os rascunhos."); }
    finally { setQueueingDrafts(false); }
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <section className="modal triage-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close}>
          ×
        </button>
        <p className="eyebrow">TRIAGEM AUTOMÁTICA</p>
        <div className="triage-title">
          <div>
            <p className="triage-kicker">CENTRO DE DECISÃO</p>
            <h2>Triagem de vagas</h2>
            <p>Regras primeiro. IA apenas para incertezas. Rascunhos somente após validação e contato confirmado.</p>
            <div className="triage-run-panel">
              <div className="triage-run-settings">
                <label>
                  Quantidade
                  <input aria-label="Quantidade de vagas" type="number" min="1" max="100" value={batchSize} onChange={(e) => setBatchSize(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} disabled={runningPilot} />
                </label>
                <label className="triage-reprocess">
                  <input type="checkbox" checked={reprocess} onChange={(e) => setReprocess(e.target.checked)} disabled={runningPilot} />
                  Reavaliar vagas já processadas
                </label>
              </div>
              <button className="primary triage-run-button" disabled={runningPilot} onClick={runPilot}>
                {runningPilot ? "Analisando vagas…" : `Analisar ${batchSize} vagas agora`}
              </button>
              <button className="triage-queue-button" disabled={queueingDrafts || runningPilot} onClick={queueDrafts}>
                {queueingDrafts ? "Preparando fila…" : "Preparar rascunhos elegíveis"}
              </button>
              <button className="triage-queue-button" disabled={queueingDrafts || runningPilot} onClick={retryFailedDrafts}>Reprocessar falhas de rascunho</button>
              <small>{sourceId ? `Exceção manual: somente vagas de hoje da fonte ${sourceLabel ?? sourceId}. ` : ""}A fila exige vaga aprovada ou provável, análise atual e e-mail de contato válido. Esta ação não cria nem envia e-mails.</small>
            </div>
          </div>
        </div>
        {message && <div className="notice">{message}</div>}
        {pilot && (
          <section className="triage-current-run" aria-label="Resultado desta execução">
            <div className="triage-section-heading"><h3>Resultado desta execução</h3><small>{pilot.processed.length} vaga(s) analisada(s) · regras e IA quando necessária</small></div>
            <div className="triage-list">
            {pilot.processed.map((item) => (
              <article key={item.jobId} className={`triage-row ${item.verdict === "BATE" ? "approved" : item.verdict === "PROVAVEL" ? "partial" : "rejected"}`}>
                <div>
                  <small>{item.company}{item.reference ? ` · Código ${item.reference}` : ""}</small>
                  <b>{item.title}</b>
                  <span>{item.label}{item.blocker ? ` · ${item.blocker}` : ""}{item.contactEligible ? " · E-mail válido cadastrado" : " · Sem e-mail válido"}</span>
                </div>
                <strong>{item.verdict === "BATE" ? "✅" : item.verdict === "PROVAVEL" ? "🟡" : "❌"}</strong>
              </article>
            ))}
            </div>
          </section>
        )}
        <section className="triage-automation" aria-label="Status da automação diária">
          <div>
            <h3>Automação diária</h3>
            <small>Triagem por regras para as vagas recebidas no dia; rascunhos só entram na fila se houver e-mail válido.</small>
          </div>
          {latestScheduled ? (
            <div className="triage-automation-status">
              <strong>{latestScheduled.status === "completed" ? "Última execução concluída" : `Última execução: ${latestScheduled.status}`}</strong>
              <span>{date(latestScheduled.completedAt ?? latestScheduled.startedAt ?? latestScheduled.createdAt)} · {latestScheduled.completed}/{latestScheduled.total} vaga(s) concluída(s)</span>
              <span>{scheduledSummary(latestScheduled)}</span>
              <span>{latestScheduled.draftsReady} rascunho(s) pronto(s) · {latestScheduled.draftsPending} aguardando criação · {latestScheduled.draftsFailed} falha(s)</span>
              {latestScheduled.error && <span className="triage-automation-error">Falha registrada: {latestScheduled.error}</span>}
            </div>
          ) : <p className="triage-automation-empty">Ainda não houve execução agendada registrada. A primeira rotina diária aparecerá aqui.</p>}
        </section>
        {operational && <section className="triage-operations" aria-label="Saúde operacional da triagem">
          <div><h3>Saúde operacional</h3><small>Fila de rascunhos e rotina diária.</small></div>
          <div className="triage-operations-metrics"><span><b>{operational.pendingDrafts}</b> na fila</span><span><b>{operational.readyDrafts}</b> prontos</span><span><b>{operational.failedDrafts}</b> com falha</span></div>
          {operational.alerts.length > 0 ? <ul>{operational.alerts.map((alert) => <li key={alert.message} className={alert.level}>{alert.message}</li>)}</ul> : <p className="triage-operations-ok">Sem alertas operacionais.</p>}
        </section>}
        {draftItems.length > 0 && <section className="triage-drafts" aria-label="Rascunhos de candidatura">
          <div><h3>Rascunhos de candidatura</h3><small>Itens da fila; o portal não envia e-mails.</small></div>
          <div className="triage-list">
            {draftItems.map((item) => <article key={item.id} className={`triage-row ${item.draftStatus === "failed" ? "rejected" : item.draftStatus === "drafted" ? "approved" : "partial"}`}>
              <div><small>{item.draftStatus === "drafted" ? "Rascunho pronto" : item.draftStatus === "failed" ? "Falha — pode reprocessar" : "Aguardando o conector Gmail"} · {item.draftUpdatedAt ? date(item.draftUpdatedAt) : date(item.processedAt)}</small><b>{item.title}</b><span>Para: {item.contactEmail ?? "Contato inválido"} · Assunto: {item.draftSubject}</span>{item.draftError && <span className="triage-draft-error">Erro: {item.draftError}</span>}</div>
              <strong>{item.draftStatus === "drafted" ? "✉️" : item.draftStatus === "failed" ? "⚠️" : "⏳"}</strong>
            </article>)}
          </div>
        </section>}
        {history.length > 0 && (
          <section className="triage-history" aria-label="Histórico persistido da nova triagem">
            <div>
              <h3>Histórico da nova triagem</h3>
            <small>Resultados gravados no sistema. A IA só refina vagas ambíguas; rascunhos exigem e-mail de contato válido.</small>
            </div>
            <div className="triage-list">
              <div className="triage-run-settings triage-table-filters">
                <label>Veredito<select value={verdictFilter} onChange={(e) => { setVerdictFilter(e.target.value); setHistoryPage(0); }}><option value="all">Todos</option><option value="✅">Aprovadas</option><option value="🟡">Prováveis</option><option value="❌">Reprovadas</option></select></label>
                <label>Origem<select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setHistoryPage(0); }}><option value="all">Regras e IA</option><option value="rules">Regras</option><option value="ai">IA</option></select></label>
                <label>Fonte<select value={jobSourceFilter} onChange={(e) => { setJobSourceFilter(e.target.value); setHistoryPage(0); }}><option value="all">Todas</option>{jobSources.map((source) => <option key={source} value={source}>{source}</option>)}</select></label>
                <label>Rascunho<select value={draftFilter} onChange={(e) => { setDraftFilter(e.target.value); setHistoryPage(0); }}><option value="all">Todos</option><option value="pending">Na fila</option><option value="drafted">Pronto</option><option value="failed">Com falha</option></select></label>
              </div>
              <div className="triage-table-wrap"><table className="triage-table"><thead><tr><th><button onClick={() => sortHistory("verdict")}>Veredito</button></th><th><button onClick={() => sortHistory("title")}>Vaga</button></th><th><button onClick={() => sortHistory("company")}>Empresa</button></th><th>Fonte / código</th><th>Local e modalidade</th><th>Publicada / recebida</th><th>Contato</th><th><button onClick={() => sortHistory("draft")}>Rascunho</button></th><th><button onClick={() => sortHistory("processedAt")}>Analisada</button></th></tr></thead><tbody>{visibleHistory.map((item) => <tr key={item.id} className={rowClass[item.verdict] ?? "backlog"}><td className="triage-verdict">{item.verdict}<small>{item.source === "ai" ? "IA" : "Regras"}</small></td><td><a href={item.url} target="_blank" rel="noreferrer"><b>{item.title}</b></a><span>{item.label}{item.blocker ? ` · ${item.blocker}` : ""}</span>{item.source === "ai" && <details><summary>Evidências</summary><pre>{item.rows}</pre></details>}</td><td>{item.company}</td><td>{item.jobSource ?? "Não informada"}<small>{item.externalId ? `Código ${item.externalId}` : "Sem código"}</small></td><td>{item.workMode ?? "—"}<small>{item.location ?? "Local não informado"}</small></td><td>{item.sourcePublishedAt ? date(item.sourcePublishedAt) : "Não informada"}<small>Recebida: {date(item.receivedAt)}</small></td><td>{item.hasValidContactEmail ? item.contactEmail : "Manual / sem e-mail"}</td><td>{item.draftStatus === "drafted" ? "Pronto" : item.draftStatus === "pending" ? "Na fila" : item.draftStatus === "failed" ? "Falhou" : "—"}</td><td>{date(item.processedAt)}</td></tr>)}</tbody></table></div>
            </div>
            {filteredHistory.length > historyPageSize && <div className="triage-run-settings"><button disabled={historyPage === 0} onClick={() => setHistoryPage(page => page - 1)}>Anterior</button><small>Página {historyPage + 1} de {Math.ceil(filteredHistory.length / historyPageSize)}</small><button disabled={(historyPage + 1) * historyPageSize >= filteredHistory.length} onClick={() => setHistoryPage(page => page + 1)}>Próxima</button></div>}
          </section>
        )}
        {history.length > 0 && <div className="triage-summary"><article className="approved"><small>Aprovadas (atuais)</small><strong>{currentAssessments.filter((item) => item.verdict === "✅").length}</strong></article><article className="partial"><small>Prováveis (atuais)</small><strong>{currentAssessments.filter((item) => item.verdict === "🟡").length}</strong></article><article className="rejected"><small>Não aderentes (atuais)</small><strong>{currentAssessments.filter((item) => item.verdict === "❌" || item.verdict === "🔴").length}</strong></article><article><small>Vagas analisadas</small><strong>{currentAssessments.length}</strong></article></div>}
      </section>
    </div>
  );
}
