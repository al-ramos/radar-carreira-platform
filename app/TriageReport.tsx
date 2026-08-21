"use client";
import { useEffect, useState } from "react";
type PilotResult = { batchId: string; processed: Array<{ jobId: string; title: string; company: string; reference: string | null; contactEligible: boolean; aiEligible: boolean; aiStatus: string; verdict: string; label: string; blocker: string | null }>; skipped: number; aiCompleted?: number };
type HistoryItem = { id: string; batchId: string; jobId: string; verdict: string; label: string; blocker: string | null; source: string; confidence: number; rows: string; processedAt: string; title: string; company: string; externalId: string | null; jobSource: string | null; workMode: string | null; location: string | null; sourcePublishedAt: string | null; receivedAt: string; url: string; contactEmail: string | null; hasValidContactEmail: boolean; draftStatus: "pending" | "drafted" | "failed" | "cancelled" | null; draftSubject: string; draftError: string | null; draftUpdatedAt: string | null; trigger: string };
type Batch = { id: string; trigger: "manual" | "scheduled" | "assistant"; scope: string; status: string; startedAt: string | null; completedAt: string | null; createdAt: string; error: string | null; total: number; completed: number; failed: number; eligible: number; eligibleWithoutContact: number; draftsPending: number; draftsReady: number; draftsFailed: number };
type Operational = { pendingDrafts: number; readyDrafts: number; failedDrafts: number; oldestPendingAt: string | null; alerts: Array<{ level: "warning" | "error"; message: string }> };
type AiReview = { id: string; response: string; jobs: Array<{ id: string; title: string; company: string }>; provider: string; model: string };
type LegacyItem = { jobId: string; veredito: string; motivo: string | null; processedAt: string; title: string; company: string; externalId: string | null; sourceId: string | null; workMode: string | null; location: string | null; sourcePublishedAt: string | null; receivedAt: string; url: string; contactEmail: string | null };
type FilterOption = { id: string; label: string; count: number };
const rowClass: Record<string, string> = { "✅": "approved", "🟡": "partial", "❌": "rejected", "🔴": "rejected" };
const MAX_AI_REVIEW_JOBS = 20;
const saoPauloToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const sourceName = (source: string) => source === "apinfo-extension" ? "APInfo" : source === "linkedin-extension" ? "LinkedIn" : source;
const homePeriodLabel = (period: string) => period === "24" ? "Últimas 24h" : period === "72" ? "Últimos 3 dias" : period === "168" ? "Últimos 7 dias" : "Todas as vagas";
export default function TriageReport({ close, sourceId, sourceLabel, sourceOptions = [], areaOptions = [], channelOptions = [], initialArea = "all", initialChannel = "all", homePeriod = "24" }: { close: () => void; sourceId?: string; sourceLabel?: string; sourceOptions?: FilterOption[]; areaOptions?: FilterOption[]; channelOptions?: FilterOption[]; initialArea?: string; initialChannel?: string; homePeriod?: "24" | "72" | "168" | "all" }) {
  const [message, setMessage] = useState("Carregando avaliações…"),
    [runningPilot, setRunningPilot] = useState(false),
    [queueingDrafts, setQueueingDrafts] = useState(false),
    [pilot, setPilot] = useState<PilotResult | null>(null),
    [actionSourceId, setActionSourceId] = useState(sourceId ?? ""),
    [actionArea, setActionArea] = useState(initialArea),
    [actionChannel, setActionChannel] = useState(initialChannel),
    [actionPeriod, setActionPeriod] = useState<"24" | "72" | "168" | "all">(homePeriod),
    [actionCandidate, setActionCandidate] = useState<{ key: string; count: number; total: number; triaged: number } | null>(null),
    [reprocess, setReprocess] = useState(false),
    [aiPromptOpen, setAiPromptOpen] = useState(false),
    [aiPrompt, setAiPrompt] = useState("Analise a aderência de cada vaga ao meu perfil, destaque evidências, lacunas e priorize as oportunidades. Não altere candidaturas nem gere rascunhos."),
    [aiReviewLoading, setAiReviewLoading] = useState(false),
    [aiReview, setAiReview] = useState<AiReview | null>(null),
    [history, setHistory] = useState<HistoryItem[]>([]),
    [batches, setBatches] = useState<Batch[]>([]),
    [operational, setOperational] = useState<Operational | null>(null),
    [verdictFilter, setVerdictFilter] = useState("all"),
    [sourceFilter, setSourceFilter] = useState("all"),
    [draftFilter, setDraftFilter] = useState("all"),
    [jobSourceFilter, setJobSourceFilter] = useState("apinfo-extension"),
    [publishedDateFilter, setPublishedDateFilter] = useState(saoPauloToday),
    [receivedDateFilter, setReceivedDateFilter] = useState(""),
    [analysedDateFilter, setAnalysedDateFilter] = useState(""),
    [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false),
    [sortKey, setSortKey] = useState<"processedAt" | "company" | "title" | "verdict" | "draft">("processedAt"),
    [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc"),
    [historyPage, setHistoryPage] = useState(0);
  const loadHistory = async () => {
    try {
      const response = await fetch("/api/triage/history");
      if (!response.ok) {
        const legacyResponse = await fetch("/api/admin/triage");
        const legacy = await legacyResponse.json() as { items?: LegacyItem[] };
        if (!legacyResponse.ok) throw new Error("Falha ao consultar as avaliações existentes.");
        const items = (legacy.items ?? []).map((item): HistoryItem => ({ id: `legacy-${item.jobId}`, batchId: "legacy", jobId: item.jobId, verdict: item.veredito, label: item.motivo ?? "Avaliação registrada", blocker: null, source: "legacy", confidence: 0, rows: "", processedAt: item.processedAt, title: item.title, company: item.company, externalId: item.externalId, jobSource: item.sourceId, workMode: item.workMode, location: item.location, sourcePublishedAt: item.sourcePublishedAt, receivedAt: item.receivedAt, url: item.url, contactEmail: item.contactEmail, hasValidContactEmail: Boolean(item.contactEmail?.includes("@")), draftStatus: null, draftSubject: "", draftError: null, draftUpdatedAt: null, trigger: "legacy" }));
        setHistory(items); setBatches([]); setOperational(null); setMessage(items.length ? "Exibindo avaliações já registradas no Radar." : "Nenhuma vaga avaliada foi encontrada.");
        return;
      }
      const data = await response.json() as { items?: HistoryItem[]; batches?: Batch[]; operational?: Operational };
      const items = data.items ?? [];
      setHistory(items); setBatches(data.batches ?? []); setOperational(data.operational ?? null);
      if (!items.length) setMessage("Nenhuma vaga foi triada ainda. Use “Analisar vagas do recorte” para iniciar.");
      else setMessage((current) => current === "Carregando avaliações…" ? "" : current);
    } catch { setMessage("Não foi possível carregar as avaliações da triagem."); }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadHistory(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const actionSelectionKey = `${actionSourceId}|${actionArea}|${actionChannel}|${actionPeriod}|${reprocess}`;
  useEffect(() => {
    if (!actionSourceId) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ sourceId: actionSourceId, includeTriaged: String(reprocess), period: actionPeriod });
    if (actionArea !== "all") query.set("roleArea", actionArea);
    if (actionChannel !== "all") query.set("ingestionChannel", actionChannel);
    void fetch(`/api/triage/preview?${query}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ count?: number; total?: number; triaged?: number }> : Promise.reject(new Error("Falha ao consultar as vagas do recorte da Home.")))
      .then((data) => setActionCandidate({ key: actionSelectionKey, count: typeof data.count === "number" ? data.count : 0, total: typeof data.total === "number" ? data.total : 0, triaged: typeof data.triaged === "number" ? data.triaged : 0 }))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setActionCandidate({ key: actionSelectionKey, count: 0, total: 0, triaged: 0 }); });
    return () => controller.abort();
  }, [actionArea, actionChannel, actionPeriod, actionSelectionKey, actionSourceId, reprocess]);
  const date = (v: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));
  const latestScheduled = batches.find((batch) => batch.trigger === "scheduled");
  const latestManual = batches.find((batch) => batch.trigger === "manual");
  const manualIsActive = latestManual?.status === "queued" || latestManual?.status === "running";
  const dayKey = (value: string | null) => value ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "";
  const latestByJob = new Map<string, HistoryItem>();
  for (const item of history) if (!latestByJob.has(item.jobId)) latestByJob.set(item.jobId, item);
  const currentAssessments = [...latestByJob.values()];
  const jobSources = [...new Set(currentAssessments.map((item) => item.jobSource).filter(Boolean))] as string[];
  const scopedHistory = currentAssessments.filter((item) => (verdictFilter === "all" || item.verdict === verdictFilter) && (sourceFilter === "all" || item.source === sourceFilter) && (jobSourceFilter === "all" || item.jobSource === jobSourceFilter) && (!publishedDateFilter || dayKey(item.sourcePublishedAt) === publishedDateFilter) && (!receivedDateFilter || dayKey(item.receivedAt) === receivedDateFilter) && (!analysedDateFilter || dayKey(item.processedAt) === analysedDateFilter));
  // Os contadores e a tabela devem falar sobre o mesmo recorte. O filtro de
  // rascunho é aplicado somente depois de contabilizar cada status.
  const draftCounts = {
    pending: scopedHistory.filter((item) => item.draftStatus === "pending").length,
    drafted: scopedHistory.filter((item) => item.draftStatus === "drafted").length,
    failed: scopedHistory.filter((item) => item.draftStatus === "failed").length,
  };
  const filteredHistory = scopedHistory.filter((item) => draftFilter === "all" || item.draftStatus === draftFilter);
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
  const historyPageCount = Math.ceil(filteredHistory.length / historyPageSize);
  const hasActiveAdvancedFilters = draftFilter !== "all" || Boolean(receivedDateFilter) || Boolean(analysedDateFilter);
  const actionSources = sourceId && !sourceOptions.some((option) => option.id === sourceId)
    ? [{ id: sourceId, label: sourceLabel ?? sourceName(sourceId), count: 0 }, ...sourceOptions]
    : sourceOptions;
  const actionCandidateCount = actionCandidate?.key === actionSelectionKey && actionSourceId ? actionCandidate.count : null;
  const actionCandidateTotal = actionCandidate?.key === actionSelectionKey && actionSourceId ? actionCandidate.total : null;
  const manualSummary = (batch: Batch) => {
    if (batch.status === "queued") return `${batch.total} vaga(s) na fila. O Radar iniciará o processamento em instantes.`;
    if (batch.status === "running") return `Processando: ${batch.completed + batch.failed}/${batch.total} vaga(s).`;
    if (batch.status === "failed") return `Falhou em ${batch.failed} de ${batch.total} vaga(s). Veja o histórico antes de preparar rascunhos.`;
    if (batch.status === "completed") return `Concluído: ${batch.completed}/${batch.total} vaga(s) triada(s). Agora você pode preparar os rascunhos elegíveis.`;
    return `${batch.completed}/${batch.total} vaga(s) registradas.`;
  };
  const scheduledSummary = (batch: Batch) => {
    if (batch.total === 0) return "Nenhuma vaga nova pendente de avaliação foi encontrada para este dia.";
    if (batch.eligible === 0) return "Nenhuma vaga aderente ou provável foi encontrada neste lote.";
    if (batch.eligibleWithoutContact === batch.eligible) return "As vagas elegíveis continuam sem e-mail de contato válido; nenhum rascunho foi preparado.";
    return `${batch.eligible} vaga(s) elegível(is); somente as que têm contato válido podem gerar rascunho.`;
  };
  const runToday = async () => {
    if (!actionSourceId || !actionCandidateCount) return;
    setRunningPilot(true);
    setMessage(`Enfileirando ${actionCandidateCount} vaga(s) do recorte ${homePeriodLabel(actionPeriod)}…`);
    try {
      const response = await fetch("/api/triage/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: actionSourceId, dateScope: "published", homePeriod: actionPeriod, roleArea: actionArea, ingestionChannel: actionChannel, batchSize: actionCandidateCount, reprocess, aiMode: "off" }),
      });
      const result = await response.json() as { batchId: string | null; queued?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível iniciar a fila de triagem.");
      setPilot(null);
      setMessage(result.queued ? `Lote iniciado: ${result.queued} vaga(s) de ${sourceName(actionSourceId)} serão processadas em segundo plano. Acompanhe o progresso no histórico.` : "Nenhuma vaga nova precisa ser triada nesse recorte.");
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
    if (draftCounts.failed === 0) {
      setMessage(`Nenhuma falha para reprocessar. ${draftCounts.drafted} rascunho(s) já está(ão) pronto(s) para revisão.`);
      return;
    }
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
  const requestAiReview = async () => {
    if (!actionSourceId || !actionCandidateCount || actionCandidateCount > MAX_AI_REVIEW_JOBS || aiPrompt.trim().length < 8) return;
    setAiReviewLoading(true);
    setMessage(`Enviando o recorte de ${actionCandidateCount} vaga(s) para a análise da IA…`);
    try {
      const response = await fetch("/api/triage/ai-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: actionSourceId, homePeriod: actionPeriod, roleArea: actionArea, ingestionChannel: actionChannel, includeTriaged: reprocess, prompt: aiPrompt }),
      });
      const result = await response.json() as AiReview & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível solicitar a análise da IA.");
      setAiReview(result);
      setAiPromptOpen(false);
      setMessage(`Análise da IA concluída para ${actionCandidateCount} vaga(s). Nenhum veredito, rascunho ou candidatura foi alterado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível solicitar a análise da IA.");
    } finally {
      setAiReviewLoading(false);
    }
  };
  const openHistory = (nextDraftFilter = "all") => {
    setDraftFilter(nextDraftFilter);
    setHistoryPage(0);
    window.setTimeout(() => document.getElementById("triage-history")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const openAutomationActions = () => {
    const actions = document.querySelector<HTMLDetailsElement>(".triage-actions");
    if (actions) {
      actions.open = true;
      actions.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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
            <details className="triage-actions">
              <summary>Exibir ações de automação</summary>
              <div className="triage-run-panel">
                <div className="triage-run-settings">
                  <label>
                    Fonte
                    <select aria-label="Fonte das vagas a analisar" value={actionSourceId} onChange={(e) => setActionSourceId(e.target.value)} disabled={runningPilot}>
                      <option value="">Selecione uma fonte</option>
                      {actionSources.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    Área
                    <select aria-label="Área das vagas a analisar" value={actionArea} onChange={(e) => setActionArea(e.target.value)} disabled={runningPilot}>
                      <option value="all">Todas</option>
                      {areaOptions.filter((option) => option.count > 0).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    Canal
                    <select aria-label="Canal de entrada das vagas a analisar" value={actionChannel} onChange={(e) => setActionChannel(e.target.value)} disabled={runningPilot}>
                      <option value="all">Todos</option>
                      {channelOptions.filter((option) => option.count > 0).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="triage-reprocess">
                    <input type="checkbox" checked={reprocess} onChange={(e) => setReprocess(e.target.checked)} disabled={runningPilot} />
                    Incluir vagas já triadas
                  </label>
                  <label>
                    Período da triagem
                    <select aria-label="Período das vagas a analisar" value={actionPeriod} onChange={(e) => setActionPeriod(e.target.value as "24" | "72" | "168" | "all")} disabled={runningPilot}>
                      <option value="24">Últimas 24h</option>
                      <option value="72">Últimos 3 dias</option>
                      <option value="168">Últimos 7 dias</option>
                      <option value="all">Todas as vagas</option>
                    </select>
                  </label>
                </div>
                <div className="triage-run-selection" aria-live="polite">
                  {actionCandidateCount === null ? "Selecione uma fonte para consultar o recorte da triagem." : actionCandidateCount === 0 && actionCandidateTotal ? `Há ${actionCandidateTotal} vaga${actionCandidateTotal === 1 ? "" : "s"} no recorte ${homePeriodLabel(actionPeriod)}, mas todas já foram triadas.` : actionCandidateCount === 0 ? `Nenhuma vaga corresponde aos filtros da triagem em ${homePeriodLabel(actionPeriod)}.` : `${actionCandidateCount} vaga${actionCandidateCount === 1 ? "" : "s"} aguardando triagem, de ${actionCandidateTotal} no recorte ${homePeriodLabel(actionPeriod)}.`}
                  {actionCandidateCount === 0 && Boolean(actionCandidateTotal) && !reprocess && <span>Marque “Incluir vagas já triadas” para reavaliar as vagas desse recorte.</span>}
                  {actionCandidateCount !== null && actionCandidateCount > 100 && <span>O lote por regras será processado em segundo plano, em blocos controlados.</span>}
                  {actionCandidateCount !== null && actionCandidateCount > MAX_AI_REVIEW_JOBS && <span>A análise com IA aceita até {MAX_AI_REVIEW_JOBS} vagas por vez; refine o recorte para solicitar a leitura.</span>}
                </div>
                <div className="triage-action-steps">
                  <article className="triage-action-step">
                    <span>1</span><div><b>Triar por regras</b><small>Classifica as vagas. Não cria nem envia e-mails.</small></div>
                    <button className="primary triage-run-button" disabled={runningPilot || aiReviewLoading || !actionCandidateCount || manualIsActive} onClick={runToday}>{runningPilot ? "Iniciando fila…" : `Analisar ${actionCandidateCount ? `(${actionCandidateCount})` : ""}`}</button>
                  </article>
                  <article className="triage-action-step triage-ai-step">
                    <span>IA</span><div><b>Consulta à IA <em>opcional</em></b><small>Faz uma leitura consultiva; não muda a triagem nem cria rascunhos.</small></div>
                    <button className="triage-queue-button" disabled={runningPilot || aiReviewLoading || !actionCandidateCount || actionCandidateCount > MAX_AI_REVIEW_JOBS} onClick={() => setAiPromptOpen(true)}>{aiReviewLoading ? "Consultando…" : "Consultar"}</button>
                  </article>
                  <article className={`triage-action-step ${manualIsActive ? "waiting" : ""}`}>
                    <span>2</span><div><b>Preparar rascunhos</b><small>Use após a etapa 1 concluir. Separa apenas vagas ✅/🟡 com e-mail válido; não envia nada.</small></div>
                    <button className="triage-queue-button" disabled={queueingDrafts || runningPilot || manualIsActive} onClick={queueDrafts} title={manualIsActive ? "Aguarde a triagem concluir antes de preparar rascunhos." : undefined}>{queueingDrafts ? "Preparando…" : "Preparar"}</button>
                  </article>
                  <article className="triage-action-step triage-retry-step">
                    <span>↻</span><div><b>Reprocessar falhas</b><small>Use somente se a fila de rascunhos informar falha.</small></div>
                    <button className="triage-queue-button" disabled={queueingDrafts || runningPilot || draftCounts.failed === 0} onClick={retryFailedDrafts} title={draftCounts.failed === 0 ? "Não há falhas para reprocessar" : undefined}>Reprocessar{draftCounts.failed ? ` (${draftCounts.failed})` : ""}</button>
                  </article>
                </div>
                {aiPromptOpen && <section className="triage-ai-prompt" aria-label="Prompt para análise de vagas pela IA">
                  <b>O que você quer que a IA avalie?</b>
                  <small>Ela receberá um snapshot das {actionCandidateCount ?? 0} vagas deste recorte e do seu perfil. A resposta é apenas consultiva.</small>
                  <textarea aria-label="Instrução para a IA" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} maxLength={1200} disabled={aiReviewLoading} />
                  <div><button type="button" className="triage-queue-button" onClick={() => setAiPromptOpen(false)} disabled={aiReviewLoading}>Cancelar</button><button type="button" className="primary" onClick={requestAiReview} disabled={aiReviewLoading || aiPrompt.trim().length < 8}>Solicitar análise</button></div>
                </section>}
                {aiReview && <section className="triage-ai-review" aria-label="Resultado da análise da IA"><div><h3>Análise da IA</h3><small>{aiReview.jobs.length} vagas · {aiReview.provider} · {aiReview.model}</small></div><p>{aiReview.response}</p></section>}
                <small>Acompanhe o resultado no cartão “Último lote manual”, logo abaixo. Depois de preparar, o Gmail cria os rascunhos pendentes na rotina configurada; eles nunca são enviados automaticamente. A consulta à IA é opcional e não altera o fluxo.</small>
              </div>
            </details>
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
        <section className="triage-automation" aria-label="Automação diária e saúde operacional">
          <div className="triage-automation-intro">
            <h3>Automação diária</h3>
            <small>Triagem por regras para as vagas recebidas no dia; rascunhos só entram na fila se houver e-mail válido.</small>
          </div>
          <div className="triage-automation-main">
            {latestScheduled ? (
              <div className="triage-automation-status">
                <strong>{latestScheduled.status === "completed" ? "Última execução concluída" : `Última execução: ${latestScheduled.status}`}</strong>
                <span>{date(latestScheduled.completedAt ?? latestScheduled.startedAt ?? latestScheduled.createdAt)} · {latestScheduled.completed}/{latestScheduled.total} vaga(s) concluída(s)</span>
                <span>{scheduledSummary(latestScheduled)}</span>
                {latestScheduled.error && <span className="triage-automation-error">Falha registrada: {latestScheduled.error}</span>}
              </div>
            ) : <p className="triage-automation-empty">Ainda não há execução agendada registrada. Abra as ações para iniciar a primeira triagem.</p>}
            <div className="triage-automation-actions">
              {latestScheduled ? <button type="button" className="triage-card-action" onClick={() => openHistory()}>Ver histórico</button> : <button type="button" className="triage-card-action" onClick={openAutomationActions}>Abrir ações de automação</button>}
            </div>
          </div>
          {operational && <div className="triage-operations-inline">
            <div className="triage-operations-heading"><strong>Rascunhos de candidatura</strong><small>{operational.alerts.length ? `${operational.alerts.length} aviso sobre a automação` : "Automação e rascunhos em dia."}</small></div>
            <div className="triage-operations-metrics">
              <button type="button" onClick={() => openHistory("pending")}><b>{draftCounts.pending}</b> aguardando criação</button>
              <button type="button" onClick={() => openHistory("drafted")}><b>{draftCounts.drafted}</b> prontos para revisar</button>
              <button type="button" className={draftCounts.failed ? "has-failures" : ""} onClick={() => openHistory("failed")}><b>{draftCounts.failed}</b> falhas para corrigir</button>
            </div>
            {operational.alerts.length > 0 && <ul>{operational.alerts.map((alert) => <li key={alert.message} className={alert.level}>{alert.message}</li>)}</ul>}
          </div>}
        </section>
        {(
          <section id="triage-history" className="triage-history" aria-label="Histórico persistido da nova triagem">
            <div className="triage-history-heading">
              <div>
                <h3>Histórico da triagem</h3>
                <small>Use os filtros para escolher exatamente as vagas que deseja consultar.</small>
              </div>
              <div className="triage-summary triage-summary-compact" aria-label="Resumo do filtro atual">
                <article className="approved"><small>Aprovadas</small><strong>{filteredHistory.filter((item) => item.verdict === "✅").length}</strong></article>
                <article className="partial"><small>Prováveis</small><strong>{filteredHistory.filter((item) => item.verdict === "🟡").length}</strong></article>
                <article className="rejected"><small>Não aderentes</small><strong>{filteredHistory.filter((item) => item.verdict === "❌" || item.verdict === "🔴").length}</strong></article>
                <article><small>Analisadas</small><strong>{filteredHistory.length}</strong></article>
              </div>
            </div>
            <div className="triage-list">
              <div className="triage-run-settings triage-table-filters">
                <label>Veredito<select value={verdictFilter} onChange={(e) => { setVerdictFilter(e.target.value); setHistoryPage(0); }}><option value="all">Todos</option><option value="✅">Aprovadas</option><option value="🟡">Prováveis</option><option value="❌">Reprovadas</option></select></label>
                <label>Origem<select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setHistoryPage(0); }}><option value="all">Regras, IA e histórico</option><option value="rules">Regras</option><option value="ai">IA</option><option value="legacy">Histórico do Radar</option></select></label>
                <label>Fonte<select value={jobSourceFilter} onChange={(e) => { setJobSourceFilter(e.target.value); setHistoryPage(0); }}><option value="all">Todas</option>{jobSources.map((source) => <option key={source} value={source}>{sourceName(source)}</option>)}</select></label>
                <label>Publicada em<input type="date" value={publishedDateFilter} onChange={(e) => { setPublishedDateFilter(e.target.value); setHistoryPage(0); }} /></label>
                <details className="triage-advanced-filters" open={advancedFiltersOpen || hasActiveAdvancedFilters} onToggle={(event) => setAdvancedFiltersOpen(event.currentTarget.open)}>
                  <summary>Mais filtros</summary>
                  <div>
                    <label>Rascunho<select value={draftFilter} onChange={(e) => { setDraftFilter(e.target.value); setHistoryPage(0); }}><option value="all">Todos</option><option value="pending">Na fila</option><option value="drafted">Pronto</option><option value="failed">Com falha</option></select></label>
                    <label>Recebida em<input type="date" value={receivedDateFilter} onChange={(e) => { setReceivedDateFilter(e.target.value); setHistoryPage(0); }} /></label>
                    <label>Analisada em<input type="date" value={analysedDateFilter} onChange={(e) => { setAnalysedDateFilter(e.target.value); setHistoryPage(0); }} /></label>
                  </div>
                </details>
                <button type="button" className="triage-clear-filters" onClick={() => { setVerdictFilter("all"); setSourceFilter("all"); setJobSourceFilter("apinfo-extension"); setDraftFilter("all"); setPublishedDateFilter(saoPauloToday()); setReceivedDateFilter(""); setAnalysedDateFilter(""); setAdvancedFiltersOpen(false); setHistoryPage(0); }}>Consulta APInfo de hoje</button>
              </div>
              {filteredHistory.length > historyPageSize && <nav className="triage-pagination" aria-label="Paginação do histórico">
                <button type="button" disabled={historyPage === 0} onClick={() => setHistoryPage(page => page - 1)}>← Anterior</button>
                <span><b>{historyPage * historyPageSize + 1}–{Math.min((historyPage + 1) * historyPageSize, filteredHistory.length)}</b> de {filteredHistory.length} vagas</span>
                <small>Página {historyPage + 1} de {historyPageCount}</small>
                <button type="button" disabled={(historyPage + 1) * historyPageSize >= filteredHistory.length} onClick={() => setHistoryPage(page => page + 1)}>Próxima →</button>
              </nav>}
              <div className="triage-table-wrap"><table className="triage-table"><thead><tr><th><button onClick={() => sortHistory("verdict")}>Veredito</button></th><th><button onClick={() => sortHistory("title")}>Vaga</button></th><th><button onClick={() => sortHistory("company")}>Empresa</button></th><th>Fonte / código</th><th>Local e modalidade</th><th>Publicada / recebida</th><th>Contato</th><th><button onClick={() => sortHistory("draft")}>Rascunho</button></th><th><button onClick={() => sortHistory("processedAt")}>Analisada</button></th></tr></thead><tbody>{visibleHistory.length ? visibleHistory.map((item) => <tr key={item.id} className={rowClass[item.verdict] ?? "backlog"}><td className="triage-verdict">{item.verdict}<small>{item.source === "ai" ? "IA" : item.source === "legacy" ? "Radar" : "Regras"}</small></td><td><a href={item.url} target="_blank" rel="noreferrer"><b>{item.title}</b></a><span>{item.label}{item.blocker ? ` · ${item.blocker}` : ""}</span>{item.source === "ai" && <details><summary>Evidências</summary><pre>{item.rows}</pre></details>}</td><td>{item.company}</td><td>{item.jobSource ? sourceName(item.jobSource) : "Não informada"}<small>{item.externalId ? `Código ${item.externalId}` : "Sem código"}</small></td><td>{item.workMode ?? "—"}<small>{item.location ?? "Local não informado"}</small></td><td>{item.sourcePublishedAt ? date(item.sourcePublishedAt) : "Não informada"}<small>Recebida: {date(item.receivedAt)}</small></td><td>{item.hasValidContactEmail ? item.contactEmail : "Manual / sem e-mail"}</td><td>{item.draftStatus === "drafted" ? "Pronto" : item.draftStatus === "pending" ? "Na fila" : item.draftStatus === "failed" ? "Falhou" : "—"}</td><td>{date(item.processedAt)}</td></tr>) : <tr><td className="triage-table-empty" colSpan={9}>Nenhuma vaga corresponde aos filtros selecionados.</td></tr>}</tbody></table></div>
            </div>
          </section>
        )}
        <section className="triage-manual-status" aria-live="polite" aria-label="Acompanhamento do lote manual">
          <div><p className="eyebrow">SEU ÚLTIMO LOTE</p><h3>{latestManual ? latestManual.status === "completed" ? "Triagem concluída" : latestManual.status === "failed" ? "Triagem com falha" : latestManual.status === "running" ? "Triagem em andamento" : "Triagem na fila" : "Nenhum lote manual iniciado"}</h3></div>
          {latestManual ? <><p>{manualSummary(latestManual)}</p><div><button type="button" className="triage-card-action" onClick={() => void loadHistory()}>Atualizar status</button><button type="button" className="triage-card-action secondary" onClick={() => openHistory()}>Ver resultados</button></div></> : <p>Escolha o recorte acima e use a etapa 1. O andamento e o resultado aparecerão aqui.</p>}
        </section>
      </section>
    </div>
  );
}
