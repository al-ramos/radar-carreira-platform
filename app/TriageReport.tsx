"use client";
import { useEffect, useRef, useState } from "react";
type PilotResult = { batchId: string; processed: Array<{ jobId: string; title: string; company: string; reference: string | null; contactEligible: boolean; aiEligible: boolean; aiStatus: string; verdict: string; label: string; blocker: string | null }>; skipped: number; aiCompleted?: number };
type HistoryItem = { id: string; batchId: string; jobId: string; verdict: string | null; label: string; blocker: string | null; source: string; confidence: number; rows: string; processedAt: string | null; title: string; company: string; externalId: string | null; description: string; stack: string; jobSource: string | null; workMode: string | null; location: string | null; sourcePublishedAt: string | null; receivedAt: string; url: string; contactEmail: string | null; hasValidContactEmail: boolean; draftStatus: "pending" | "drafted" | "sent" | "failed" | "cancelled" | null; draftSubject: string; draftError: string | null; draftUpdatedAt: string | null; gmailSentId: string | null; sentAt: string | null; trigger: string };
type Batch = { id: string; trigger: "manual" | "scheduled" | "assistant"; scope: string; status: string; startedAt: string | null; completedAt: string | null; createdAt: string; error: string | null; total: number; completed: number; failed: number; eligible: number; eligibleWithoutContact: number; draftsPending: number; draftsReady: number; draftsFailed: number };
type BatchItem = { batchId: string; jobId: string; status: "queued" | "processing" | "completed" | "failed" | "skipped"; error: string | null; attemptCount: number; updatedAt: string; leaseUntil: string | null; title: string; company: string; externalId: string | null };
type Operational = { pendingDrafts: number; readyDrafts: number; sentDrafts: number; failedDrafts: number; oldestPendingAt: string | null; alerts: Array<{ level: "warning" | "error"; message: string }> };
type HistoryRecovery = { available: number };
type QueueUsage = { budget: number; reservedOperations: number; retryOperations: number; resetAt: string };
type AiReview = { id: string; response?: string | null; jobs?: Array<{ id: string; title: string; company: string }>; provider?: string | null; model?: string | null; status?: string; total?: number; completed?: number; failed?: number; chunks?: number; queued?: number; error?: string | null };
type CodexQueueItem = { id: string; status: "pending" | "claimed" | "completed" | "failed"; createdAt: string; claimedAt?: string | null; completedAt?: string | null; error?: string | null; selection: { filters?: { jobIds?: string[] } } };
type AiCareerRules = { professionalName: string; professionalTitle: string; professionalSummary: string; baseLocation: string; acceptedRegions: string[]; maxHybridDays: number; preferredContracts: string[]; dailyCommunicationLanguages: string[]; blockedSeniorities: string[]; blockedWorkTypes: string[]; coreStack: string[]; coreStackMatchMode: "all" | "any"; stackExceptions: string[]; anchorProject: string };
type AiProfile = { name: string | null; seniority: string[]; preferredMode: string[]; masteredSkills: string[]; desiredAreas: string[]; avoidTerms: string[]; minScore: number; careerRules: AiCareerRules };
type LegacyItem = { jobId: string; veredito: string; motivo: string | null; processedAt: string; title: string; company: string; externalId: string | null; sourceId: string | null; workMode: string | null; location: string | null; sourcePublishedAt: string | null; receivedAt: string; url: string; contactEmail: string | null };
type FilterOption = { id: string; label: string; count: number };
const rowClass: Record<string, string> = { "✅": "approved", "🟡": "partial", "❌": "rejected", "🔴": "rejected" };
const CODEX_BATCH_SIZE = 50;
const sourceName = (source: string) => source === "all" ? "todas as fontes" : source === "apinfo-extension" ? "APInfo" : source === "linkedin-extension" ? "LinkedIn" : source;
const homePeriodLabel = (period: string) => period === "24" ? "recebidas nas últimas 24h" : period === "72" ? "recebidas nos últimos 3 dias" : period === "168" ? "recebidas nos últimos 7 dias" : "todas as vagas";
const profileList = (values: string[], fallback: string) => values.length ? values.join(" · ") : fallback;
const readJsonResponse = async <T,>(response: Response, action: string): Promise<T> => {
  const body = await response.text();
  if (!body.trim()) throw new Error(`${action} não recebeu resposta do serviço. Tente novamente.`);
  try { return JSON.parse(body) as T; }
  catch { throw new Error(`${action} retornou uma página de erro do servidor. Tente novamente em instantes.`); }
};
export default function TriageReport({ open = true, close, openJobInRadar, sourceId, sourceLabel, sourceOptions = [], areaOptions = [], channelOptions = [], initialArea = "all", initialChannel = "all", homePeriod = "24", highlightBatchId }: { open?: boolean; close: () => void; openJobInRadar: (job: Pick<HistoryItem, "jobId" | "externalId" | "jobSource">) => void; sourceId?: string; sourceLabel?: string; sourceOptions?: FilterOption[]; areaOptions?: FilterOption[]; channelOptions?: FilterOption[]; initialArea?: string; initialChannel?: string; homePeriod?: "24" | "72" | "168" | "all"; highlightBatchId?: string }) {
  const [message, setMessage] = useState("Carregando avaliações…"),
    [runningPilot, setRunningPilot] = useState(false),
    [resumingBatch, setResumingBatch] = useState(false),
    [queueingDrafts, setQueueingDrafts] = useState(false),
    [draftActionStatuses, setDraftActionStatuses] = useState<Record<string, { kind: "done" | "waiting" | "failed"; text: string }>>({}),
    [reconcilingSentJobId, setReconcilingSentJobId] = useState<string | null>(null),
    [pilot, setPilot] = useState<PilotResult | null>(null),
    [actionSourceId, setActionSourceId] = useState(sourceId ?? "all"),
    [actionArea, setActionArea] = useState(initialArea),
    [actionChannel, setActionChannel] = useState(initialChannel),
    [actionPeriod, setActionPeriod] = useState<"24" | "72" | "168" | "all">(homePeriod),
    [actionCandidate, setActionCandidate] = useState<{ key: string; count: number; total: number; triaged: number } | null>(null),
    [reprocess, setReprocess] = useState(false),
    [aiPromptOpen, setAiPromptOpen] = useState(false),
    [aiPrompt, setAiPrompt] = useState("Analise a aderência de cada vaga ao meu perfil, destaque evidências, lacunas e priorize as oportunidades. Não altere candidaturas nem gere rascunhos."),
    [aiReviewLoading, setAiReviewLoading] = useState(false),
    [codexQueueLoading, setCodexQueueLoading] = useState(false),
    [aiReview, setAiReview] = useState<AiReview | null>(null),
    [activeAiJobId, setActiveAiJobId] = useState<string | null>(null),
    [activeCodexJobId, setActiveCodexJobId] = useState<string | null>(null),
    [codexJobStatus, setCodexJobStatus] = useState<"preparing" | "ready" | "failed" | null>(null),
    [codexQueueItems, setCodexQueueItems] = useState<CodexQueueItem[]>([]),
    [aiTargetJobIds, setAiTargetJobIds] = useState<string[] | null>(null),
    [aiProfile, setAiProfile] = useState<AiProfile | null>(null),
    [aiProfileLoading, setAiProfileLoading] = useState(false),
    [aiProfileError, setAiProfileError] = useState(""),
    [actionSourceOptions, setActionSourceOptions] = useState<FilterOption[] | null>(null),
    [history, setHistory] = useState<HistoryItem[]>([]),
    [selectedHistoryJobIds, setSelectedHistoryJobIds] = useState<string[]>([]),
    [batches, setBatches] = useState<Batch[]>([]),
    [batchItems, setBatchItems] = useState<BatchItem[]>([]),
    [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null),
    [syncingBatch, setSyncingBatch] = useState(false),
    [operational, setOperational] = useState<Operational | null>(null),
    [queueUsage, setQueueUsage] = useState<QueueUsage | null>(null),
    [historyRecovery, setHistoryRecovery] = useState<HistoryRecovery | null>(null),
    [recoveringHistory, setRecoveringHistory] = useState(false),
    [situationFilter, setSituationFilter] = useState<"pending" | "analysed" | "all">("all"),
    [verdictFilter, setVerdictFilter] = useState("all"),
    [sourceFilter, setSourceFilter] = useState("all"),
    [draftFilter, setDraftFilter] = useState("all"),
    [jobSourceFilter, setJobSourceFilter] = useState("all"),
    [codeFilter, setCodeFilter] = useState(""),
    [publishedDateFilter, setPublishedDateFilter] = useState(""),
    [receivedDateFilter, setReceivedDateFilter] = useState(""),
    [analysedDateFilter, setAnalysedDateFilter] = useState(""),
    [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false),
    [sortKey, setSortKey] = useState<"processedAt" | "company" | "title" | "verdict" | "draft">("processedAt"),
    [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc"),
    [historyPage, setHistoryPage] = useState(0),
    [csvImportOpen, setCsvImportOpen] = useState(false),
    [csvImportText, setCsvImportText] = useState(""),
    [csvImportLoading, setCsvImportLoading] = useState(false),
    [csvImportResult, setCsvImportResult] = useState<{ applied: number; draftsQueued: number; notFound: string[]; ambiguous: string[]; rejected: Array<{ line: number; reason: string }> } | null>(null),
    [reconcilingAllSent, setReconcilingAllSent] = useState(false);
  const aiPromptRef = useRef<HTMLTextAreaElement>(null);
  const loadHistory = async () => {
    try {
      const response = await fetch("/api/triage/history");
      if (!response.ok) {
        const legacyResponse = await fetch("/api/admin/triage");
        const legacy = await legacyResponse.json() as { items?: LegacyItem[] };
        if (!legacyResponse.ok) throw new Error("Falha ao consultar as avaliações existentes.");
        const items = (legacy.items ?? []).map((item): HistoryItem => ({ id: `legacy-${item.jobId}`, batchId: "legacy", jobId: item.jobId, verdict: item.veredito, label: item.motivo ?? "Avaliação registrada", blocker: null, source: "legacy", confidence: 0, rows: "", processedAt: item.processedAt, title: item.title, company: item.company, externalId: item.externalId, description: "", stack: "[]", jobSource: item.sourceId, workMode: item.workMode, location: item.location, sourcePublishedAt: item.sourcePublishedAt, receivedAt: item.receivedAt, url: item.url, contactEmail: item.contactEmail, hasValidContactEmail: Boolean(item.contactEmail?.includes("@")), draftStatus: null, draftSubject: "", draftError: null, draftUpdatedAt: null, gmailSentId: null, sentAt: null, trigger: "legacy" }));
        // Uma falha transitória em /api/triage/history não pode apagar o lote
        // manual em andamento: mantém batches/batchItems/operational como
        // estavam e só complementa o histórico com o acervo legado. Sem isso,
        // um 500 passageiro durante "Sincronizar agora" fazia o card "SEU
        // ÚLTIMO LOTE" sumir mesmo com a triagem ainda rodando na fila.
        setHistory((current) => current.length ? current : items);
        setMessage(items.length ? "Exibindo avaliações já registradas no Radar." : "Nenhuma vaga avaliada foi encontrada.");
        return true;
      }
      const data = await response.json() as { items?: HistoryItem[]; batches?: Batch[]; batchItems?: BatchItem[]; operational?: Operational; recovery?: HistoryRecovery };
      const items = data.items ?? [];
      setHistory(items); setBatches(data.batches ?? []); setBatchItems(data.batchItems ?? []); setOperational(data.operational ?? null); setHistoryRecovery(data.recovery ?? null); setLastSyncedAt(new Date());
      if (!items.length) setMessage("Nenhuma vaga foi triada ainda. Use “Analisar vagas do recorte” para iniciar.");
      else setMessage((current) => current === "Carregando avaliações…" ? "" : current);
      return true;
    } catch { setMessage("Não foi possível carregar as avaliações da triagem."); return false; }
  };
  const recoverMissingHistory = async () => {
    setRecoveringHistory(true);
    setMessage("Restaurando avaliações já concluídas no histórico…");
    try {
      const response = await fetch("/api/triage/history/repair", { method: "POST" });
      const result = await readJsonResponse<{ recovered?: number; error?: string }>(response, "A recuperação do histórico");
      if (!response.ok) throw new Error(result.error ?? "Não foi possível recuperar o histórico.");
      await loadHistory();
      setMessage(result.recovered ? `${result.recovered} avaliação(ões) concluída(s) foram restauradas no histórico.` : "O histórico já estava conciliado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível recuperar o histórico.");
    } finally {
      setRecoveringHistory(false);
    }
  };
  const loadCodexQueue = async () => {
    try {
      const response = await fetch("/api/triage/codex-queue?state=all");
      if (!response.ok) return;
      const data = await readJsonResponse<{ items?: CodexQueueItem[] }>(response, "O acompanhamento do Codex");
      setCodexQueueItems(data.items ?? []);
    } catch { /* A triagem continua disponível mesmo se o histórico do Codex não carregar. */ }
  };
  const loadQueueUsage = async () => {
    try {
      const response = await fetch("/api/triage/queue-usage");
      if (response.ok) setQueueUsage(await readJsonResponse<QueueUsage>(response, "O uso das filas"));
    } catch { /* A triagem permanece utilizável se a telemetria estiver indisponível. */ }
  };
  useEffect(() => {
    // O painel pode montar fechado enquanto a Home termina de carregar. Só
    // consulta o histórico quando ele estiver visível e refaz a carga na
    // primeira abertura, sem depender de alterar um filtro.
    if (!open) return;
    const timer = window.setTimeout(() => { void loadHistory(); void loadCodexQueue(); void loadQueueUsage(); }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEffect(() => {
    if (!aiReview?.id || ["completed", "partial_failed", "failed", "blocked"].includes(aiReview.status ?? "")) return;
    const timer = window.setInterval(() => void fetch(`/api/triage/ai-review?id=${aiReview.id}`).then(async (response) => response.ok ? readJsonResponse<AiReview>(response, "Acompanhamento da análise") : null).then(result => { if (result) { setAiReview(result); if (["completed", "partial_failed", "failed"].includes(result.status ?? "")) setMessage(result.status === "completed" ? "Análise da IA concluída. Nenhuma decisão operacional foi alterada." : result.error ?? "A análise terminou com falhas parciais."); } }).catch(() => undefined), 3000);
    return () => window.clearInterval(timer);
  }, [aiReview?.id, aiReview?.status]);
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
  useEffect(() => {
    // A lista de fontes deste card precisa refletir o "Período da triagem"
    // escolhido aqui — não o período da lista da Home, que é outro filtro,
    // independente. Sem isso, uma fonte com vagas fora do período da Home
    // some do dropdown mesmo com "Todas as vagas" selecionado aqui.
    const controller = new AbortController();
    const query = new URLSearchParams({ period: actionPeriod });
    if (actionArea !== "all") query.set("area", actionArea);
    if (actionChannel !== "all") query.set("channel", actionChannel);
    void fetch(`/api/jobs?${query}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ filterOptions?: { sources?: FilterOption[] } }> : Promise.reject(new Error("Falha ao consultar fontes do período.")))
      .then((data) => setActionSourceOptions(data.filterOptions?.sources ?? []))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setActionSourceOptions(null); });
    return () => controller.abort();
  }, [actionArea, actionChannel, actionPeriod]);
  const date = (v: string | null) => v
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v))
    : "—";
  const latestScheduled = batches.find((batch) => batch.trigger === "scheduled");
  const highlightedBatch = highlightBatchId ? batches.find((batch) => batch.id === highlightBatchId) : undefined;
  const highlightedBatchItems = highlightedBatch ? batchItems.filter((item) => item.batchId === highlightedBatch.id) : [];
  const latestManual = batches.find((batch) => batch.trigger === "manual");
  // Um lote sem itens pode permanecer registrado como "queued" quando a fila
  // não encontrou trabalho. Ele deve continuar auditável, mas não pode impedir
  // que o usuário inicie a próxima triagem do recorte.
  const manualIsActive = (latestManual?.status === "queued" || latestManual?.status === "running") && (latestManual.total ?? 0) > 0;
  const latestManualItems = latestManual ? batchItems.filter((item) => item.batchId === latestManual.id) : [];
  const manualItemCounts = latestManualItems.reduce((counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }), { queued: 0, processing: 0, completed: 0, failed: 0, skipped: 0 });
  const recoverableManualItemCount = latestManualItems.filter((item) => {
    const updatedAt = new Date(item.updatedAt).getTime();
    const leaseUntil = item.leaseUntil ? new Date(item.leaseUntil).getTime() : 0;
    const staleQueued = item.status === "queued" && updatedAt < Date.now() - 5 * 60_000;
    const expiredProcessing = item.status === "processing" && leaseUntil <= Date.now();
    return staleQueued || expiredProcessing;
  }).length;
  useEffect(() => {
    if (!manualIsActive) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadHistory(); }, 4000);
    return () => window.clearInterval(timer);
  }, [manualIsActive, latestManual?.id]);
  useEffect(() => {
    if (!highlightBatchId || !highlightedBatch) return;
    const timer = window.setTimeout(() => document.getElementById("triage-notification-log")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    return () => window.clearTimeout(timer);
  }, [highlightBatchId, highlightedBatch]);
  const dayKey = (value: string | null) => value ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(value)) : "";
  const latestByJob = new Map<string, HistoryItem>();
  for (const item of history) if (!latestByJob.has(item.jobId)) latestByJob.set(item.jobId, item);
  const currentAssessments = [...latestByJob.values()];
  const aiTargetJobs = aiTargetJobIds ? currentAssessments.filter((item) => aiTargetJobIds.includes(item.jobId)) : [];
  const isIndividualAiReview = aiTargetJobIds?.length === 1;
  const jobSources = [...new Set(currentAssessments.map((item) => item.jobSource).filter(Boolean))] as string[];
  // "Não analisada" cobre tanto vaga sem veredito quanto veredito ⚪ (marcação
  // neutra usada para zerar backlog em lote) — nenhum dos dois passou por
  // avaliação real ainda. Ver RC-TI-024.
  const isPending = (item: HistoryItem) => !item.verdict || item.verdict === "⚪";
  const scopedHistory = currentAssessments.filter((item) => (situationFilter === "all" || (situationFilter === "pending" ? isPending(item) : !isPending(item))) && (verdictFilter === "all" || item.verdict === verdictFilter) && (sourceFilter === "all" || item.source === sourceFilter) && (jobSourceFilter === "all" || item.jobSource === jobSourceFilter) && (!codeFilter.trim() || (item.externalId ?? "").toLowerCase().includes(codeFilter.trim().toLowerCase())) && (!publishedDateFilter || dayKey(item.sourcePublishedAt) === publishedDateFilter) && (!receivedDateFilter || dayKey(item.receivedAt) === receivedDateFilter) && (!analysedDateFilter || dayKey(item.processedAt) === analysedDateFilter));
  // Os contadores e a tabela devem falar sobre o mesmo recorte. O filtro de
  // rascunho é aplicado somente depois de contabilizar cada status.
  const draftCounts = {
    pending: scopedHistory.filter((item) => item.draftStatus === "pending").length,
    drafted: scopedHistory.filter((item) => item.draftStatus === "drafted").length,
    sent: scopedHistory.filter((item) => item.draftStatus === "sent").length,
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
    return (fields[sortKey][0] ?? "").localeCompare(fields[sortKey][1] ?? "", "pt-BR", { numeric: true }) * (sortDirection === "asc" ? 1 : -1);
  });
  const historyPageSize = 10;
  const visibleHistory = orderedHistory.slice(historyPage * historyPageSize, (historyPage + 1) * historyPageSize);
  const selectedHistory = currentAssessments.filter((item) => selectedHistoryJobIds.includes(item.jobId));
  const allVisibleSelected = visibleHistory.length > 0 && visibleHistory.every((item) => selectedHistoryJobIds.includes(item.jobId));
  const allFilteredSelected = filteredHistory.length > 0 && filteredHistory.every((item) => selectedHistoryJobIds.includes(item.jobId));
  const toggleHistoryJob = (jobId: string) => setSelectedHistoryJobIds((current) => current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId]);
  const toggleVisibleHistory = () => setSelectedHistoryJobIds((current) => allVisibleSelected ? current.filter((id) => !visibleHistory.some((item) => item.jobId === id)) : [...new Set([...current, ...visibleHistory.map((item) => item.jobId)])]);
  const draftActionBlocker = (item: HistoryItem) => {
    if (item.draftStatus) return item.draftStatus === "sent" ? (item.gmailSentId ? "Enviado confirmado pelo Gmail" : "Envio informado manualmente") : item.draftStatus === "drafted" ? "Rascunho pronto" : item.draftStatus === "pending" ? `Aguardando você acionar a criação pela fila. Fila atualizada: ${date(item.draftUpdatedAt ?? item.processedAt)}` : "Reveja a falha antes";
    if (item.jobSource === "linkedin-extension") return "LinkedIn não permite rascunho";
    if (item.verdict !== "✅" && item.verdict !== "🟡") return "Exige vaga aderente ou provável";
    if (!item.hasValidContactEmail) return "E-mail válido exigido";
    return null;
  };
  const historyPageCount = Math.ceil(filteredHistory.length / historyPageSize);
  const hasActiveAdvancedFilters = draftFilter !== "all" || Boolean(publishedDateFilter) || Boolean(receivedDateFilter) || Boolean(analysedDateFilter);
  const periodScopedSourceOptions = actionSourceOptions ?? sourceOptions;
  const actionSources = sourceId && !periodScopedSourceOptions.some((option) => option.id === sourceId)
    ? [{ id: sourceId, label: sourceLabel ?? sourceName(sourceId), count: 0 }, ...periodScopedSourceOptions]
    : periodScopedSourceOptions;
  const actionCandidateCount = actionCandidate?.key === actionSelectionKey && actionSourceId ? actionCandidate.count : null;
  const actionCandidateTotal = actionCandidate?.key === actionSelectionKey && actionSourceId ? actionCandidate.total : null;
  const manualSummary = (batch: Batch) => {
    if (batch.total === 0) return "Nenhuma vaga ficou pendente neste recorte. Escolha outro período ou atualize os filtros para iniciar uma nova triagem.";
    if (batch.status === "queued") return `${batch.total} vaga(s) na fila prioritária. O processamento deve iniciar em até 2 minutos; se não houver avanço, o Radar reenfileira automaticamente com segurança.`;
    if (batch.status === "running") return `Processando: ${batch.completed + batch.failed}/${batch.total} vaga(s).`;
    if (batch.status === "failed") return `Falhou em ${batch.failed} de ${batch.total} vaga(s). Veja o histórico antes de preparar rascunhos.`;
    if (batch.status === "completed") return `Concluído: ${batch.completed}/${batch.total} vaga(s) triada(s). Agora você pode preparar os rascunhos elegíveis.`;
    return `${batch.completed}/${batch.total} vaga(s) registradas.`;
  };
  const batchItemStatus = (item: BatchItem) => item.status === "queued" ? "Aguardando na fila" : item.status === "processing" ? "Em processamento" : item.status === "completed" ? "Concluída" : item.status === "skipped" ? "Ignorada" : "Falhou";
  const syncManualBatch = async () => {
    setSyncingBatch(true);
    setMessage("Sincronizando o status do lote…");
    const updated = await loadHistory();
    if (updated) setMessage("Status do lote sincronizado com a fila.");
    setSyncingBatch(false);
  };
  const resumePendingBatch = async () => {
    if (!latestManual) return;
    setResumingBatch(true);
    setMessage("Retomando somente os itens pendentes ou com reserva expirada…");
    try {
      const response = await fetch("/api/triage/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resume", batchId: latestManual.id }),
      });
      const result = await readJsonResponse<{ resumed?: number; error?: string }>(response, "A retomada da fila");
      if (!response.ok) throw new Error(result.error ?? "Não foi possível retomar a fila.");
      setMessage(result.resumed ? `${result.resumed} item(ns) pendente(s) foram reenfileirados com segurança.` : "Não há itens pendentes antigos para reenfileirar.");
      await loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível retomar a fila.");
    } finally {
      setResumingBatch(false);
    }
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
        body: JSON.stringify({ sourceId: actionSourceId, dateScope: "received", homePeriod: actionPeriod, roleArea: actionArea, ingestionChannel: actionChannel, reprocess, aiMode: "off" }),
      });
      const result = await readJsonResponse<{ batchId: string | null; queued?: number; batchSize?: number; hasMore?: boolean; error?: string }>(response, "A fila de triagem");
      if (!response.ok) throw new Error(result.error ?? "Não foi possível iniciar a fila de triagem.");
      setPilot(null);
      setMessage(result.queued ? `Lote iniciado: ${result.queued} vaga(s) de ${sourceName(actionSourceId)} serão processadas em segundo plano.${result.hasMore ? ` Quando este lote concluir, inicie o próximo lote de ${result.batchSize ?? result.queued} vagas.` : ""} Acompanhe o progresso no histórico.` : "Nenhuma vaga nova precisa ser triada nesse recorte.");
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir o piloto.");
    } finally {
      setRunningPilot(false);
    }
  };
  const queueDrafts = async (jobIds?: string[]) => {
    setQueueingDrafts(true);
    setMessage(jobIds?.length ? `Verificando ${jobIds.length} vaga(s) selecionada(s) para a fila de rascunhos…` : "Verificando vagas elegíveis para a fila de rascunhos…");
    try {
      const response = await fetch("/api/triage/drafts/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: actionSourceId, roleArea: actionArea, ingestionChannel: actionChannel, homePeriod: actionPeriod, jobIds }),
      });
      const result = await response.json() as { error?: string; considered: number; queued: number; noValidContact: number; outdated: number; alreadyPresent: number; immediateDraft?: { requested: boolean; created?: number; reason?: string } };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível preparar a fila de rascunhos.");
      const queueMessagePrefix = jobIds?.length ? "Fila preparada para a seleção" : "Fila preparada para este recorte";
      const immediateMessage = result.immediateDraft?.requested
        ? result.immediateDraft.created ? ` ${result.immediateDraft.created} rascunho(s) foi(ram) criado(s) agora no Gmail; nenhum e-mail foi enviado.` : " A criação foi acionada agora no Gmail; atualize a tela em instantes para confirmar os rascunhos."
        : ` Criação manual indisponível: ${result.immediateDraft?.reason ?? "tente novamente pela fila."}`;
      setMessage(`${queueMessagePrefix} (${result.considered} vaga(s)): ${result.queued} elegível(is); ${result.noValidContact} sem e-mail válido; ${result.outdated} precisa(m) de nova avaliação; ${result.alreadyPresent} já estava(m) na fila.${immediateMessage}`);
      if (jobIds?.length === 1) {
        const status = result.immediateDraft?.requested
          ? result.immediateDraft.created
            ? { kind: "done" as const, text: "Rascunho criado agora no Gmail; nenhum e-mail foi enviado." }
            : { kind: "waiting" as const, text: "Gmail acionado; atualize em instantes para confirmar o rascunho." }
          : { kind: "failed" as const, text: `Criação manual indisponível: ${result.immediateDraft?.reason ?? "tente novamente pela fila."}` };
        setDraftActionStatuses((current) => ({ ...current, [jobIds[0]]: status }));
      }
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível preparar a fila de rascunhos.");
      if (jobIds?.length === 1) setDraftActionStatuses((current) => ({ ...current, [jobIds[0]]: { kind: "failed", text: error instanceof Error ? error.message : "Não foi possível preparar o rascunho." } }));
    } finally {
      setQueueingDrafts(false);
    }
  };
  const downloadSelectedHistoryCsv = () => {
    if (!selectedHistory.length) return;
    const csvCell = (value: string | null | undefined) => `"${(value ?? "").replace(/"/g, '""')}"`;
    const jobDescription = (item: HistoryItem) => {
      let stack: string[] = [];
      try {
        const parsed = JSON.parse(item.stack);
        stack = Array.isArray(parsed) ? parsed.filter((skill): skill is string => typeof skill === "string") : [];
      } catch { /* detalhes legados sem stack */ }
      return [item.description.trim(), stack.length ? `Stack: ${stack.join(", ")}` : ""].filter(Boolean).join(" · ") || "Detalhes não informados";
    };
    const csv = [
      "codigo;titulo;status;descricao",
      ...selectedHistory.map((item) => [item.externalId ?? item.jobId, item.title, item.label || "Não analisada", jobDescription(item)].map(csvCell).join(";")),
    ].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    link.download = `triagem-vagas-selecionadas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    setMessage(`CSV baixado com ${selectedHistory.length} vaga(s) selecionada(s).`);
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
  const reconcileSentDraft = async (jobId: string) => {
    setReconcilingSentJobId(jobId);
    setMessage("Consultando o Gmail para confirmar o envio desta vaga…");
    try {
      const response = await fetch("/api/triage/drafts/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reconcileSent", jobIds: [jobId] }) });
      const result = await readJsonResponse<{ confirmed?: number; alreadySent?: boolean; error?: string }>(response, "A atualização do envio");
      if (!response.ok) throw new Error(result.error ?? "Não foi possível consultar o Gmail agora.");
      if (result.alreadySent || result.confirmed) {
        setMessage("Envio confirmado pelo Gmail e atualizado no Radar.");
      } else if (window.confirm("O Gmail ainda não localizou esta mensagem. Você confirma que já a enviou? O Radar atualizará somente o acompanhamento; nenhuma mensagem será enviada.")) {
        await confirmSentDraft(jobId, true);
        return;
      } else {
        setMessage("O Gmail ainda não encontrou esse envio. Confira o destinatário e o assunto e tente novamente.");
      }
      await loadHistory();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível consultar o Gmail agora."); }
    finally { setReconcilingSentJobId(null); }
  };
  const confirmSentDraft = async (jobId: string, alreadyConfirmed = false) => {
    if (!alreadyConfirmed && !window.confirm("Confirmar que este e-mail já foi enviado? O Radar somente atualizará o acompanhamento; nenhuma mensagem será enviada.")) return;
    setReconcilingSentJobId(jobId);
    try {
      const response = await fetch("/api/triage/drafts/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirmSent", jobIds: [jobId] }) });
      const result = await readJsonResponse<{ confirmed?: number; alreadySent?: boolean; error?: string }>(response, "A confirmação manual do envio");
      if (!response.ok) throw new Error(result.error ?? "Não foi possível confirmar o envio agora.");
      setMessage(result.alreadySent ? "Este envio já estava registrado no Radar." : "Envio confirmado manualmente e atualizado no Radar.");
      await loadHistory();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível confirmar o envio agora."); }
    finally { setReconcilingSentJobId(null); }
  };
  const requestAiReview = async (jobIds = aiTargetJobIds) => {
    const aiCount = jobIds?.length ?? actionCandidateCount ?? 0;
    if ((!jobIds && !actionSourceId) || !aiCount || aiPrompt.trim().length < 8) return;
    setAiReviewLoading(true);
    if (jobIds?.length === 1) setActiveAiJobId(jobIds[0]);
    setMessage(`Enviando ${jobIds ? "a seleção de" : "o recorte de"} ${aiCount} vaga(s) para a análise da IA…`);
    try {
      const response = await fetch("/api/triage/ai-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId: actionSourceId, homePeriod: actionPeriod, roleArea: actionArea, ingestionChannel: actionChannel, includeTriaged: reprocess, jobIds: jobIds ?? undefined, prompt: aiPrompt }),
      });
      const result = await readJsonResponse<AiReview & { error?: string }>(response, "A solicitação de análise");
      if (!response.ok) throw new Error(result.error ?? "Não foi possível solicitar a análise da IA.");
      setAiReview({ ...result, status: result.status ?? "queued", total: result.total ?? result.chunks });
      setAiPromptOpen(false);
      setMessage(`Análise solicitada para ${aiCount} vaga(s), em ${result.chunks ?? 0} lote(s). O resultado aparecerá aqui quando concluir.`);
    } catch (error) {
      if (jobIds?.length === 1) setActiveAiJobId(null);
      setMessage(error instanceof Error ? error.message : "Não foi possível solicitar a análise da IA.");
    } finally {
      setAiReviewLoading(false);
    }
  };
  const prepareCodexReview = async (jobIds = aiTargetJobIds) => {
    const aiCount = jobIds?.length ?? actionCandidateCount ?? 0;
    if ((!jobIds && !actionSourceId) || !aiCount || aiPrompt.trim().length < 8) return;
    setCodexQueueLoading(true);
    if (jobIds?.length === 1) { setActiveCodexJobId(jobIds[0]); setCodexJobStatus("preparing"); }
    setMessage(`Preparando ${jobIds ? "a seleção de" : "o recorte de"} ${aiCount} vaga(s) para a análise no Codex…`);
    try {
      const batches = jobIds ? Array.from({ length: Math.ceil(jobIds.length / CODEX_BATCH_SIZE) }, (_, index) => jobIds.slice(index * CODEX_BATCH_SIZE, (index + 1) * CODEX_BATCH_SIZE)) : [undefined];
      let queued = 0;
      const created: CodexQueueItem[] = [];
      for (let index = 0; index < batches.length; index += 1) {
        const batchJobIds = batches[index];
        let response: Response | null = null;
        let result: { id: string; queued?: number; status?: CodexQueueItem["status"]; error?: string } | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          setMessage(`Enviando lote ${index + 1} de ${batches.length} para a fila do Codex (${batchJobIds?.length ?? aiCount} vaga(s))…`);
          response = await fetch("/api/triage/codex-queue", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sourceId: actionSourceId, homePeriod: actionPeriod, roleArea: actionArea, ingestionChannel: actionChannel, includeTriaged: reprocess, jobIds: batchJobIds, prompt: aiPrompt }),
          });
          if (response.status === 429) {
            const retryAfter = Number(response.headers.get("retry-after"));
            if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 1000));
            continue;
          }
          result = await readJsonResponse<{ id: string; queued?: number; status?: CodexQueueItem["status"]; error?: string }>(response, "A preparação para o Codex");
          break;
        }
        if (!response?.ok || !result) throw new Error("A fila do Codex continua limitada no momento. Aguarde alguns instantes e envie novamente os lotes que faltaram.");
        queued += result.queued ?? batchJobIds?.length ?? 0;
        created.push({ id: result.id, status: result.status ?? "pending", createdAt: new Date().toISOString(), selection: { filters: { jobIds: batchJobIds } } });
      }
      if (jobIds?.length === 1) {
        setCodexJobStatus("ready");
      }
      setCodexQueueItems((items) => [...created, ...items.filter((item) => !created.some((review) => review.id === item.id))]);
      setAiPromptOpen(false);
      setMessage(`${queued} vaga(s) foram preparadas em ${batches.length} lote(s) de até ${CODEX_BATCH_SIZE} e aguardam a sua solicitação nesta conversa do Codex. Quando o Codex concluir com veredito ✅ ou 🟡, o rascunho é liberado automaticamente.`);
    } catch (error) {
      if (jobIds?.length === 1) setCodexJobStatus("failed");
      setMessage(error instanceof Error ? error.message : "Não foi possível preparar a análise para o Codex.");
    } finally {
      setCodexQueueLoading(false);
    }
  };
  const reconcileAllSentDrafts = async () => {
    setReconcilingAllSent(true);
    setMessage("Verificando envios no Gmail para todos os rascunhos pendentes…");
    try {
      const response = await fetch("/api/triage/drafts/queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reconcileSent" }) });
      const result = await readJsonResponse<{ checked?: number; confirmed?: number; error?: string }>(response, "A verificação de envios");
      if (!response.ok) throw new Error(result.error ?? "Não foi possível verificar os envios agora.");
      setMessage(!result.checked ? "Nenhum rascunho aguardando confirmação de envio." : `${result.confirmed ?? 0} de ${result.checked} rascunho(s) confirmado(s) como enviado(s) no Gmail.`);
      await loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível verificar os envios agora.");
    } finally {
      setReconcilingAllSent(false);
    }
  };
  const loadCsvImportFile = async (file: File) => {
    if (file.size > 2_000_000) { setMessage("O arquivo CSV excede o limite de 2 MB."); return; }
    setCsvImportText(await file.text());
  };
  const submitCsvImport = async () => {
    if (!csvImportText.trim()) return;
    setCsvImportLoading(true);
    setCsvImportResult(null);
    setMessage("Reimportando análise externa…");
    try {
      const response = await fetch("/api/admin/triage-import", { method: "POST", headers: { "content-type": "text/csv" }, body: csvImportText });
      const result = await readJsonResponse<{ applied?: number; draftsQueued?: number; notFound?: string[]; ambiguous?: string[]; rejected?: Array<{ line: number; reason: string }>; error?: string }>(response, "A reimportação da análise");
      if (!response.ok) throw new Error(result.error ?? "Não foi possível reimportar a análise.");
      setCsvImportResult({ applied: result.applied ?? 0, draftsQueued: result.draftsQueued ?? 0, notFound: result.notFound ?? [], ambiguous: result.ambiguous ?? [], rejected: result.rejected ?? [] });
      setMessage(`${result.applied ?? 0} veredito(s) substituído(s)${result.draftsQueued ? `, ${result.draftsQueued} rascunho(s) enfileirado(s)` : ""}.`);
      await loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível reimportar a análise.");
    } finally {
      setCsvImportLoading(false);
    }
  };
  const copyCodexRequest = async () => {
    const text = "Analise todas as triagens pendentes preparadas para o Codex.";
    try { await navigator.clipboard.writeText(text); setMessage("Pedido para o Codex copiado. Cole-o nesta conversa para iniciar a análise."); }
    catch { setMessage(`Escreva nesta conversa: “${text}”`); }
  };
  const openAiPrompt = async (jobIds?: string[]) => {
    setAiTargetJobIds(jobIds?.length ? jobIds : null);
    setAiPromptOpen(true);
    setMessage(jobIds?.length ? `Consulta individual da IA preparada para ${jobIds.length} vaga(s). Escolha abaixo se quer analisar no portal ou preparar para o Codex.` : "Consulta da IA preparada. Escolha abaixo como deseja continuar.");
    const actions = document.querySelector<HTMLDetailsElement>(".triage-actions");
    if (actions) actions.open = true;
    window.setTimeout(() => {
      aiPromptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      aiPromptRef.current?.focus();
    }, 0);
    if (aiProfile || aiProfileLoading) return;
    setAiProfileLoading(true);
    setAiProfileError("");
    try {
      const response = await fetch("/api/profile");
      const result = await readJsonResponse<{ profile?: AiProfile }>(response, "O carregamento do perfil");
      if (!response.ok || !result.profile) throw new Error("Perfil indisponível");
      setAiProfile(result.profile);
    } catch {
      setAiProfileError("Não foi possível exibir o perfil agora. A análise continuará usando o perfil salvo no Radar.");
    } finally {
      setAiProfileLoading(false);
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
    <div className="modal-backdrop" onClick={close} hidden={!open}>
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
                {aiPromptOpen && aiTargetJobIds ? <div className="triage-individual-ai-selection" aria-live="polite">
                  <span>{isIndividualAiReview ? "Consulta individual" : `Consulta de ${aiTargetJobIds.length} vagas selecionadas`}</span>
                  <b>{isIndividualAiReview ? aiTargetJobs[0] ? `${aiTargetJobs[0].title} — ${aiTargetJobs[0].company}` : "Vaga selecionada" : "Somente as vagas selecionadas serão processadas"}</b>
                  <small>{isIndividualAiReview ? "A IA analisará somente esta vaga. Os filtros do recorte não serão usados." : "A IA analisará somente as vagas selecionadas. Os filtros do recorte não serão usados."}</small>
                </div> : <div className="triage-run-settings">
                  <label>
                    Fonte
                    <select aria-label="Fonte das vagas a analisar" value={actionSourceId} onChange={(e) => setActionSourceId(e.target.value)} disabled={runningPilot}>
                      <option value="all">Todas as fontes</option>
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
                      <option value="24">Recebidas nas últimas 24h</option>
                      <option value="72">Recebidas nos últimos 3 dias</option>
                      <option value="168">Recebidas nos últimos 7 dias</option>
                      <option value="all">Todas as vagas</option>
                    </select>
                  </label>
                </div>}
                {!(aiPromptOpen && aiTargetJobIds) && <><div className="triage-run-selection" aria-live="polite">
                  {actionCandidateCount === null ? "Selecione uma fonte para consultar o recorte da triagem." : actionCandidateCount === 0 && actionCandidateTotal ? `Há ${actionCandidateTotal} vaga${actionCandidateTotal === 1 ? "" : "s"} no recorte ${homePeriodLabel(actionPeriod)}, mas todas já foram triadas.` : actionCandidateCount === 0 ? `Nenhuma vaga corresponde aos filtros da triagem em ${homePeriodLabel(actionPeriod)}.` : `${actionCandidateCount} vaga${actionCandidateCount === 1 ? "" : "s"} aguardando triagem, de ${actionCandidateTotal} no recorte ${homePeriodLabel(actionPeriod)}.`}
                  {actionCandidateCount === 0 && Boolean(actionCandidateTotal) && !reprocess && <span>Marque “Incluir vagas já triadas” para reavaliar as vagas desse recorte.</span>}
                  {actionCandidateCount !== null && actionCandidateCount > 100 && <span>O lote por regras será processado em segundo plano, em blocos controlados.</span>}
                  {actionCandidateCount !== null && actionCandidateCount > 20 && <span>A consulta à IA será processada em segundo plano, em lotes controlados.</span>}
                </div>
                <div className="triage-action-steps">
                  {recoverableManualItemCount > 0 && <article className="triage-action-step waiting">
                    <span>↻</span><div><b>Fila em recuperação</b><small>{recoverableManualItemCount} vaga(s) ficaram sem atualização. O Radar reenfileira automaticamente em até 2 minutos; você também pode retomar agora.</small></div>
                    <button className="triage-queue-button" disabled={resumingBatch} onClick={() => void resumePendingBatch()}>{resumingBatch ? "Retomando…" : `Retomar (${recoverableManualItemCount})`}</button>
                  </article>}
                  <article className="triage-action-step">
                    <span>1</span><div><b>Triar por regras</b><small>Classifica as vagas. Não cria nem envia e-mails.</small></div>
                    <button className="primary triage-run-button" disabled={runningPilot || aiReviewLoading || !actionCandidateCount || manualIsActive} onClick={runToday}>{runningPilot ? "Iniciando fila…" : `Analisar ${actionCandidateCount ? `(${actionCandidateCount})` : ""}`}</button>
                  </article>
                  <article className="triage-action-step triage-ai-step">
                    <span>IA</span><div><b>Consulta à IA <em>opcional</em></b><small>Se a IA concluir ✅ ou 🟡, esse veredito vira oficial e libera a fila de rascunho.</small></div>
                    <button className="triage-queue-button" disabled={runningPilot || aiReviewLoading || codexQueueLoading || !actionCandidateCount} onClick={() => void openAiPrompt()}>{aiReviewLoading || codexQueueLoading ? "Preparando…" : "Escolher"}</button>
                  </article>
                  <article className="triage-action-step triage-csv-import-step">
                    <span>CSV</span><div><b>Reimportar análise externa</b><small>Substitui o veredito das vagas pelo status do CSV (código, status, descrição). Pode enfileirar rascunho, como um veredito normal.</small></div>
                    <button className="triage-queue-button" onClick={() => setCsvImportOpen((open) => !open)}>{csvImportOpen ? "Fechar" : "Importar"}</button>
                  </article>
                  <article className={`triage-action-step ${manualIsActive ? "waiting" : ""}`}>
                    <span>2</span><div><b>Preparar rascunhos</b><small>Use após a etapa 1 concluir. Separa apenas vagas ✅/🟡 com e-mail válido; não envia nada.</small></div>
                    <button className="triage-queue-button" disabled={queueingDrafts || runningPilot || manualIsActive || !actionSourceId} onClick={queueDrafts} title={manualIsActive ? "Aguarde a triagem concluir antes de preparar rascunhos." : !actionSourceId ? "Selecione uma fonte para preparar rascunhos do recorte." : undefined}>{queueingDrafts ? "Preparando…" : "Preparar"}</button>
                  </article>
                  <article className="triage-action-step triage-retry-step">
                    <span>↻</span><div><b>Reprocessar falhas</b><small>Use somente se a fila de rascunhos informar falha.</small></div>
                    <button className="triage-queue-button" disabled={queueingDrafts || runningPilot || draftCounts.failed === 0} onClick={retryFailedDrafts} title={draftCounts.failed === 0 ? "Não há falhas para reprocessar" : undefined}>Reprocessar{draftCounts.failed ? ` (${draftCounts.failed})` : ""}</button>
                  </article>
                </div></>}
                {queueUsage && <small className="triage-queue-quota" aria-live="polite">Filas hoje: {queueUsage.reservedOperations.toLocaleString("pt-BR")} de {queueUsage.budget.toLocaleString("pt-BR")} operações reservadas{queueUsage.retryOperations ? ` · ${queueUsage.retryOperations} retry(s) observado(s)` : ""}. Reset: {date(queueUsage.resetAt)}.</small>}
                {aiPromptOpen && <section className="triage-ai-prompt" aria-label="Prompt para análise de vagas pela IA">
                  <div className="triage-ai-prompt-heading"><b>Perfil e stack que a IA vai usar</b><small>Esta é a referência do seu perfil salvo no Radar para analisar {aiTargetJobIds?.length ?? actionCandidateCount ?? 0} vaga(s) {aiTargetJobIds ? "selecionada(s)" : "do recorte"}.</small></div>
                  {aiProfileLoading && <small>Carregando o perfil salvo…</small>}
                  {aiProfileError && <small className="triage-ai-profile-error">{aiProfileError}</small>}
                  {aiProfile && <dl className="triage-ai-profile">
                    <div className="triage-ai-profile-wide"><dt>Posicionamento profissional</dt><dd>{aiProfile.careerRules.professionalTitle || "Não informado"}{aiProfile.careerRules.professionalSummary ? ` — ${aiProfile.careerRules.professionalSummary}` : ""}</dd></div>
                    <div><dt>Senioridade</dt><dd>{profileList(aiProfile.seniority, "Não informada")}</dd></div>
                    <div><dt>Modelo</dt><dd>{profileList(aiProfile.preferredMode, "Sem preferência informada")}</dd></div>
                    <div><dt>Áreas</dt><dd>{profileList(aiProfile.desiredAreas, "Não informadas")}</dd></div>
                    <div className="triage-ai-profile-wide"><dt>Stack dominada</dt><dd>{profileList(aiProfile.masteredSkills, "Nenhuma competência cadastrada")}</dd></div>
                    <div><dt>Localização e híbrido</dt><dd>{[aiProfile.careerRules.baseLocation, ...aiProfile.careerRules.acceptedRegions].filter(Boolean).join(" · ") || "Não informados"}{aiProfile.careerRules.acceptedRegions.length ? ` · até ${aiProfile.careerRules.maxHybridDays} dia(s) presencial(is)/semana` : ""}</dd></div>
                    <div><dt>Contratos</dt><dd>{profileList(aiProfile.careerRules.preferredContracts, "Sem preferência informada")}</dd></div>
                    <div><dt>Idiomas</dt><dd>{profileList(aiProfile.careerRules.dailyCommunicationLanguages, "Não informados")}</dd></div>
                    <div><dt>Stack principal</dt><dd>{profileList(aiProfile.careerRules.coreStack, "Não definida")}{aiProfile.careerRules.coreStack.length ? ` · exigir ${aiProfile.careerRules.coreStackMatchMode === "all" ? "todas" : "qualquer uma"}` : ""}</dd></div>
                    <div><dt>Exceções técnicas</dt><dd>{profileList(aiProfile.careerRules.stackExceptions, "Nenhuma")}</dd></div>
                    <div><dt>Restrições</dt><dd>{[aiProfile.careerRules.blockedSeniorities.length ? `Níveis: ${aiProfile.careerRules.blockedSeniorities.join(", ")}` : "", aiProfile.careerRules.blockedWorkTypes.length ? `Atuações: ${aiProfile.careerRules.blockedWorkTypes.join(", ")}` : "", aiProfile.avoidTerms.length ? `Termos: ${aiProfile.avoidTerms.join(", ")}` : ""].filter(Boolean).join(" · ") || "Nenhuma"}</dd></div>
                    <div className="triage-ai-profile-wide"><dt>Projeto ou experiência-âncora</dt><dd>{aiProfile.careerRules.anchorProject || "Não informado"}</dd></div>
                    <div><dt>Score mínimo do Radar</dt><dd>{aiProfile.minScore}</dd></div>
                  </dl>}
                  <div className="triage-ai-prompt-heading"><b>{isIndividualAiReview ? "Processar somente esta vaga" : "O que você quer que a IA avalie?"}</b><small>{isIndividualAiReview ? "A consulta usará somente a vaga identificada acima; um veredito ✅ ou 🟡 já vira oficial e libera o rascunho." : "Escolha se quer receber a leitura agora no portal ou preparar este mesmo recorte para conversar com o Codex aqui."}</small></div>
                  <textarea ref={aiPromptRef} aria-label="Instrução para a IA" value={aiPrompt} onChange={(event) => setAiPrompt(event.target.value)} maxLength={1200} disabled={aiReviewLoading || codexQueueLoading} />
                  <div><button type="button" className="triage-queue-button" onClick={() => setAiPromptOpen(false)} disabled={aiReviewLoading || codexQueueLoading}>Cancelar</button><button type="button" className="triage-queue-button" onClick={() => void prepareCodexReview()} disabled={aiReviewLoading || codexQueueLoading || aiPrompt.trim().length < 8}>{codexQueueLoading ? "Preparando…" : isIndividualAiReview ? "Preparar esta vaga para o Codex" : "Preparar para o Codex"}</button><button type="button" className="primary" onClick={() => void requestAiReview()} disabled={aiReviewLoading || codexQueueLoading || aiPrompt.trim().length < 8}>{aiReviewLoading ? "Solicitando…" : isIndividualAiReview ? "Analisar esta vaga" : "Solicitar análise"}</button></div>
                </section>}
                {aiReview && <section className="triage-ai-review" aria-label="Resultado da análise da IA"><div><h3>Análise da IA</h3><small>{aiReview.status === "completed" ? "Concluída" : `${aiReview.completed ?? 0}/${aiReview.total ?? aiReview.chunks ?? 0} lotes concluídos`} · {aiReview.provider ?? "processando"}{aiReview.model ? ` · ${aiReview.model}` : ""}</small></div>{aiReview.response ? <p>{aiReview.response}</p> : <p>{aiReview.error ?? "A análise está sendo processada em segundo plano."}</p>}</section>}
                {csvImportOpen && <section className="triage-csv-import triage-ai-prompt" aria-label="Reimportar análise externa em CSV">
                  <div className="triage-ai-prompt-heading"><b>Reimportar análise externa (CSV)</b><small>Colunas: código, status (✅/🟡/🔴/❌ ou texto), descrição. O status do CSV substitui o veredito atual da vaga e é registrado com origem &quot;IA&quot;; até 2.000 linhas / 2 MB por vez.</small></div>
                  <input type="file" accept=".csv,text/csv" aria-label="Selecionar arquivo CSV de análise" disabled={csvImportLoading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadCsvImportFile(file); event.target.value = ""; }} />
                  <textarea aria-label="Conteúdo CSV da análise" value={csvImportText} onChange={(event) => setCsvImportText(event.target.value)} placeholder={"codigo,status,descricao\n85981,🟡,Provável com ressalvas"} disabled={csvImportLoading} />
                  <div><button type="button" className="triage-queue-button" onClick={() => { setCsvImportOpen(false); setCsvImportText(""); setCsvImportResult(null); }} disabled={csvImportLoading}>Cancelar</button><button type="button" className="primary" onClick={() => void submitCsvImport()} disabled={csvImportLoading || !csvImportText.trim()}>{csvImportLoading ? "Importando…" : "Substituir vereditos"}</button></div>
                  {csvImportResult && <div className="triage-csv-import-result" aria-live="polite">
                    <span><b>{csvImportResult.applied}</b> veredito(s) substituído(s){csvImportResult.draftsQueued ? `, ${csvImportResult.draftsQueued} rascunho(s) enfileirado(s)` : ""}.</span>
                    {csvImportResult.notFound.length > 0 && <small>Código(s) não encontrado(s): {csvImportResult.notFound.join(", ")}</small>}
                    {csvImportResult.ambiguous.length > 0 && <small>Código(s) ambíguo(s) (mais de uma vaga, não aplicados): {csvImportResult.ambiguous.join(", ")}</small>}
                    {csvImportResult.rejected.length > 0 && <small>Linha(s) rejeitada(s): {csvImportResult.rejected.map((r) => `${r.line} (${r.reason})`).join(", ")}</small>}
                  </div>}
                </section>}
              <small>Acompanhe o resultado no cartão “Último lote manual”, logo abaixo. Ao usar “Preparar”, o Gmail cria esse lote uma única vez; não há agendamento e nenhum e-mail é enviado automaticamente. A consulta à IA é opcional; um veredito ✅ ou 🟡 dela já vira oficial e libera a fila de rascunho.</small>
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
              {draftCounts.drafted > 0 && <button type="button" className="triage-reconcile-all" disabled={reconcilingAllSent} onClick={() => void reconcileAllSentDrafts()} title="Aciona agora o mesmo conector que lê a pasta Enviados do Gmail, para todos os rascunhos pendentes de confirmação.">{reconcilingAllSent ? "Verificando…" : `Verificar envios (${draftCounts.drafted})`}</button>}
              <button type="button" onClick={() => openHistory("sent")}><b>{draftCounts.sent}</b> envios registrados</button>
              <button type="button" className={draftCounts.failed ? "has-failures" : ""} onClick={() => openHistory("failed")}><b>{draftCounts.failed}</b> falhas para corrigir</button>
            </div>
            {operational.alerts.length > 0 && <ul>{operational.alerts.map((alert) => <li key={alert.message} className={alert.level}>{alert.message}</li>)}</ul>}
          </div>}
        </section>
        {highlightBatchId && <section id="triage-notification-log" className="triage-notification-log" aria-label="Log completo da triagem agendada">
          {highlightedBatch ? <>
            <div><p className="eyebrow">LOG COMPLETO DA TRIAGEM AGENDADA</p><h3>{highlightedBatch.status === "completed" ? "Execução concluída" : `Execução: ${highlightedBatch.status}`}</h3><small>{date(highlightedBatch.completedAt ?? highlightedBatch.startedAt ?? highlightedBatch.createdAt)} · {highlightedBatch.completed}/{highlightedBatch.total} vaga(s) concluída(s) · {highlightedBatch.eligible} aderente(s) ou provável(is)</small></div>
            {highlightedBatch.error && <p className="triage-batch-error">{highlightedBatch.error}</p>}
            <details className="triage-batch-log" open><summary>Ver log do lote ({highlightedBatchItems.length} vaga(s))</summary><ol>{highlightedBatchItems.map((item) => <li key={item.jobId} className={item.status}><b>{batchItemStatus(item)}</b><span>{item.title} · {item.company}{item.externalId ? ` · código ${item.externalId}` : ""}</span><small>{item.attemptCount} tentativa(s) · atualização: {date(item.updatedAt)}{item.leaseUntil && item.status === "processing" ? ` · reserva até ${date(item.leaseUntil)}` : ""}</small>{item.error && <em>{item.error}</em>}</li>)}</ol></details>
          </> : <p>Carregando o log desta execução agendada…</p>}
        </section>}
        {(
          <section id="triage-history" className="triage-history" aria-label="Histórico persistido da nova triagem">
            <div className="triage-history-heading">
              <div>
                <h3>Histórico da triagem</h3>
                <small>Use os filtros para escolher exatamente as vagas que deseja consultar.</small>
              </div>
              <div className="triage-summary triage-summary-compact" aria-label="Resumo do filtro atual">
                {situationFilter === "pending" ? <article><small>Pendentes neste recorte</small><strong>{filteredHistory.length}</strong></article> : <>
                  <article className="approved"><small>Aprovadas</small><strong>{filteredHistory.filter((item) => item.verdict === "✅").length}</strong></article>
                  <article className="partial"><small>Prováveis</small><strong>{filteredHistory.filter((item) => item.verdict === "🟡").length}</strong></article>
                  <article className="rejected"><small>Não aderentes</small><strong>{filteredHistory.filter((item) => item.verdict === "❌" || item.verdict === "🔴").length}</strong></article>
                  <article><small>Analisadas</small><strong>{filteredHistory.length}</strong></article>
                </>}
              </div>
            </div>
            <div className="triage-list">
              {historyRecovery?.available ? <div className="triage-operational-alert warning" role="status"><span>Há {historyRecovery.available} avaliação(ões) concluída(s) que precisam ser restauradas no histórico.</span><button type="button" className="triage-queue-button" disabled={recoveringHistory} onClick={() => void recoverMissingHistory()}>{recoveringHistory ? "Restaurando…" : `Restaurar ${historyRecovery.available} avaliação(ões)`}</button></div> : null}
              <div className="triage-run-settings triage-table-filters">
                <label>Situação<select value={situationFilter} onChange={(e) => { setSituationFilter(e.target.value as typeof situationFilter); setHistoryPage(0); }}><option value="pending">Não analisadas</option><option value="analysed">Analisadas</option><option value="all">Todas</option></select></label>
                <label>Veredito<select value={verdictFilter} onChange={(e) => { setVerdictFilter(e.target.value); setHistoryPage(0); }}><option value="all">Todos</option><option value="✅">Aprovadas</option><option value="🟡">Prováveis</option><option value="❌">Reprovadas</option></select></label>
                <label>Origem<select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setHistoryPage(0); }}><option value="all">Regras, IA e histórico</option><option value="rules">Regras</option><option value="ai">IA</option><option value="legacy">Histórico do Radar</option></select></label>
                <label>Fonte<select value={jobSourceFilter} onChange={(e) => { setJobSourceFilter(e.target.value); setHistoryPage(0); }}><option value="all">Todas</option>{jobSources.map((source) => <option key={source} value={source}>{sourceName(source)}</option>)}</select></label>
                <label>Código<input type="text" inputMode="numeric" placeholder="Ex.: 85885" value={codeFilter} onChange={(e) => { setCodeFilter(e.target.value); setHistoryPage(0); }} /></label>
                <details className="triage-advanced-filters" open={advancedFiltersOpen || hasActiveAdvancedFilters} onToggle={(event) => setAdvancedFiltersOpen(event.currentTarget.open)}>
                  <summary>Mais filtros</summary>
                  <div>
                    <label>Publicada em<input type="date" value={publishedDateFilter} onChange={(e) => { setPublishedDateFilter(e.target.value); setHistoryPage(0); }} /></label>
                    <label>Rascunho<select value={draftFilter} onChange={(e) => { setDraftFilter(e.target.value); setHistoryPage(0); }}><option value="all">Todos</option><option value="pending">Na fila</option><option value="drafted">Pronto</option><option value="sent">Enviado</option><option value="failed">Com falha</option></select></label>
                    <label>Recebida em<input type="date" value={receivedDateFilter} onChange={(e) => { setReceivedDateFilter(e.target.value); setHistoryPage(0); }} /></label>
                    <label>Analisada em<input type="date" value={analysedDateFilter} onChange={(e) => { setAnalysedDateFilter(e.target.value); setHistoryPage(0); }} /></label>
                  </div>
                </details>
                <button type="button" className="triage-clear-filters" onClick={() => { setSituationFilter("pending"); setVerdictFilter("all"); setSourceFilter("all"); setJobSourceFilter("apinfo-extension"); setCodeFilter(""); setDraftFilter("all"); setPublishedDateFilter(""); setReceivedDateFilter(""); setAnalysedDateFilter(""); setAdvancedFiltersOpen(false); setHistoryPage(0); }}>Fila pendente da APInfo</button>
              </div>
              {filteredHistory.length > historyPageSize && <nav className="triage-pagination" aria-label="Paginação do histórico">
                <button type="button" disabled={historyPage === 0} onClick={() => setHistoryPage(page => page - 1)}>← Anterior</button>
                <span><b>{historyPage * historyPageSize + 1}–{Math.min((historyPage + 1) * historyPageSize, filteredHistory.length)}</b> de {filteredHistory.length} vagas</span>
                <small>Página {historyPage + 1} de {historyPageCount}</small>
                <button type="button" disabled={(historyPage + 1) * historyPageSize >= filteredHistory.length} onClick={() => setHistoryPage(page => page + 1)}>Próxima →</button>
                {allFilteredSelected ? <button type="button" className="triage-selection-clear" onClick={() => setSelectedHistoryJobIds([])}>Limpar seleção ({filteredHistory.length})</button> : <button type="button" className="triage-queue-button" onClick={() => setSelectedHistoryJobIds(filteredHistory.map((item) => item.jobId))}>Selecionar todas as {filteredHistory.length} vagas filtradas</button>}
              </nav>}
              {selectedHistory.length > 0 && <div className="triage-selection-actions" aria-live="polite">
                <span><b>{selectedHistory.length}</b> vaga(s) selecionada(s)</span>
                <button type="button" className="triage-queue-button" disabled={aiReviewLoading} onClick={() => void openAiPrompt(selectedHistory.map((item) => item.jobId))}>Consultar IA</button>
                <button type="button" className="triage-queue-button" onClick={downloadSelectedHistoryCsv} title="Baixa código, título, status atual e descrição do status das vagas selecionadas.">Baixar CSV</button>
                {selectedHistory.length === 1 && selectedHistory[0].draftStatus === "drafted" && <><button type="button" className="triage-queue-button" disabled={reconcilingSentJobId === selectedHistory[0].jobId} onClick={() => void reconcileSentDraft(selectedHistory[0].jobId)}>{reconcilingSentJobId === selectedHistory[0].jobId ? "Consultando Gmail…" : "Atualizar envio"}</button><button type="button" className="triage-queue-button" disabled={reconcilingSentJobId === selectedHistory[0].jobId} onClick={() => void confirmSentDraft(selectedHistory[0].jobId)}>Confirmar envio</button></>}
                <button type="button" className="triage-queue-button" disabled={queueingDrafts || selectedHistory.length > 100} onClick={() => void queueDrafts(selectedHistory.map((item) => item.jobId))} title={selectedHistory.length > 100 ? "Prepare até 100 vagas por vez." : undefined}>Preparar rascunhos</button>
                <button type="button" className="triage-selection-clear" onClick={() => setSelectedHistoryJobIds([])}>Limpar seleção</button>
              </div>}
              <div className="triage-table-wrap"><table className="triage-table"><thead><tr><th className="triage-select-column"><input aria-label="Selecionar todas as vagas visíveis" type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleHistory} /></th><th><button onClick={() => sortHistory("verdict")}>Veredito</button></th><th><button onClick={() => sortHistory("title")}>Vaga</button></th><th><button onClick={() => sortHistory("company")}>Empresa</button></th><th>Fonte / código</th><th>Local e modalidade</th><th>Publicação original / recebimento</th><th>Contato</th><th><button onClick={() => sortHistory("draft")}>Rascunho</button></th><th>Envio</th><th><button onClick={() => sortHistory("processedAt")}>Analisada</button></th><th>Ações</th></tr></thead><tbody>{visibleHistory.length ? visibleHistory.map((item) => {
                const draftBlocker = draftActionBlocker(item), draftActionStatus = draftActionStatuses[item.jobId], isActiveAi = activeAiJobId === item.jobId, isActiveCodex = activeCodexJobId === item.jobId;
                const codexQueueItem = codexQueueItems.find((review) => review.selection.filters?.jobIds?.includes(item.jobId));
                const aiLabel = isActiveAi ? aiReview?.status === "completed" ? "IA concluída" : aiReview?.status === "failed" || aiReview?.status === "partial_failed" ? "IA com falha" : `IA: ${aiReview?.completed ?? 0}/${aiReview?.total ?? 1}` : "Consultar IA";
                const codexLabel = isActiveCodex ? codexJobStatus === "ready" ? "Codex preparado" : codexJobStatus === "failed" ? "Codex falhou" : "Preparando Codex" : "Preparar Codex";
                const codexStatus = codexQueueItem?.status ?? (isActiveCodex && codexJobStatus === "ready" ? "pending" : null);
                return <tr key={item.id} className={rowClass[item.verdict ?? ""] ?? "backlog"}><td className="triage-select-column"><input aria-label={`Selecionar ${item.title}`} type="checkbox" checked={selectedHistoryJobIds.includes(item.jobId)} onChange={() => toggleHistoryJob(item.jobId)} /></td><td className="triage-verdict">{item.verdict ?? "—"}<small>{item.source === "ai" ? "IA" : item.source === "legacy" ? "Radar" : item.source === "pending" ? "Pendente" : "Regras"}</small></td><td><button type="button" className="triage-job-link" onClick={() => openJobInRadar(item)} title="Abrir esta vaga no Radar, filtrada pelo código e pela fonte."><b>{item.title}</b></button><span>{item.label}{item.blocker ? ` · ${item.blocker}` : ""}</span>{item.source === "ai" && <details><summary>Evidências</summary><pre>{item.rows}</pre></details>}</td><td>{item.company}</td><td>{item.jobSource ? sourceName(item.jobSource) : "Não informada"}<small>{item.externalId ? `Código ${item.externalId}` : "Sem código"}</small></td><td>{item.workMode ?? "—"}<small>{item.location ?? "Local não informado"}</small></td><td><b>{item.sourcePublishedAt ? `Publicada na fonte: ${date(item.sourcePublishedAt)}` : "Publicada na fonte: não informada"}</b><small>Recebida pelo Radar: {date(item.receivedAt)}</small></td><td>{item.hasValidContactEmail ? item.contactEmail : "Manual / sem e-mail"}</td><td>{item.draftStatus === "sent" ? "Rascunho usado" : item.draftStatus === "drafted" ? "Pronto" : item.draftStatus === "pending" ? "Na fila" : item.draftStatus === "failed" ? "Falhou" : "—"}</td><td>{item.sentAt ? <><b>Enviado</b><small>{date(item.sentAt)}</small></> : item.draftStatus === "drafted" ? "Ainda não enviado" : "—"}</td><td>{date(item.processedAt)}</td><td><div className="triage-row-actions" aria-live="polite"><button type="button" onClick={() => void requestAiReview([item.jobId])} disabled={aiReviewLoading || codexQueueLoading || isActiveAi && !["completed", "failed", "partial_failed"].includes(aiReview?.status ?? "")} title={isActiveAi ? "O andamento aparece neste botão; o resultado completo fica no painel de análise acima." : "Analisa esta vaga agora no portal, com a instrução padrão e sem alterar a triagem."}>{aiLabel}</button>{isActiveAi && <span className={`triage-action-status ${aiReview?.status === "completed" ? "done" : aiReview?.status === "failed" || aiReview?.status === "partial_failed" ? "failed" : "waiting"}`}>{aiReview?.status === "completed" ? "Resultado disponível abaixo" : aiReview?.status === "failed" || aiReview?.status === "partial_failed" ? aiReview.error ?? "A análise apresentou falha" : "Na fila da IA; atualiza automaticamente"}</span>}{isActiveAi && aiReview?.response && <button type="button" onClick={() => document.querySelector(".triage-ai-review")?.scrollIntoView({ behavior: "smooth", block: "center" })}>Ver resultado</button>}<button type="button" onClick={() => void prepareCodexReview([item.jobId])} disabled={aiReviewLoading || codexQueueLoading || isActiveCodex && codexJobStatus === "preparing"} title="Registra esta vaga para ser analisada nesta conversa do Codex; não inicia uma análise automática.">{codexLabel}</button>{codexStatus && <span className={`triage-action-status ${codexStatus === "failed" ? "failed" : codexStatus === "completed" ? "done" : "waiting"}`}>{codexStatus === "pending" ? "Preparado; aguardando seu pedido no Codex" : codexStatus === "claimed" ? "Análise do Codex em andamento" : codexStatus === "completed" ? "Análise do Codex concluída" : codexQueueItem?.error ?? "A análise do Codex falhou"}{codexQueueItem?.createdAt ? ` · ${date(codexQueueItem.createdAt)}` : ""}</span>}{codexStatus === "pending" && <button type="button" className="triage-codex-copy" onClick={() => void copyCodexRequest()}>Copiar pedido</button>}<button type="button" onClick={() => void queueDrafts([item.jobId])} disabled={queueingDrafts || Boolean(draftBlocker)} title={draftBlocker ?? "Cria o rascunho desta vaga agora no Gmail; nunca envia e-mail."}>Rascunho</button>{draftActionStatus && <span className={`triage-action-status ${draftActionStatus.kind}`}>{draftActionStatus.text}</span>}{draftBlocker && <small>{draftBlocker}</small>}</div></td></tr>;
              }) : <tr><td className="triage-table-empty" colSpan={12}>Nenhuma vaga corresponde aos filtros selecionados.</td></tr>}</tbody></table></div>
            </div>
          </section>
        )}
        <section className="triage-manual-status" aria-live="polite" aria-label="Acompanhamento do lote manual">
          <div><p className="eyebrow">SEU ÚLTIMO LOTE</p><h3>{latestManual ? latestManual.total === 0 ? "Nenhuma vaga pendente" : latestManual.status === "completed" ? "Triagem concluída" : latestManual.status === "failed" ? "Triagem com falha" : latestManual.status === "running" ? "Triagem em andamento" : "Triagem na fila" : "Nenhum lote manual iniciado"}</h3>{latestManual && <small className="triage-sync-status">{manualIsActive ? "Sincronização automática a cada 4 segundos" : "Estado final sincronizado"}{lastSyncedAt ? ` · atualizado às ${date(lastSyncedAt.toISOString())}` : ""}</small>}</div>
          {latestManual ? <><div className="triage-manual-progress"><p>{manualSummary(latestManual)}</p>{latestManual.total > 0 && <><div className="triage-progress-bar" aria-label={`${manualItemCounts.completed + manualItemCounts.failed + manualItemCounts.skipped} de ${latestManual.total} vagas finalizadas`}><span style={{ width: `${Math.round(((manualItemCounts.completed + manualItemCounts.failed + manualItemCounts.skipped) / latestManual.total) * 100)}%` }} /></div><div className="triage-progress-counts"><span>{manualItemCounts.queued} na fila</span><span>{manualItemCounts.processing} em análise</span><span>{manualItemCounts.completed} concluídas</span>{manualItemCounts.skipped > 0 && <span>{manualItemCounts.skipped} ignoradas</span>}{manualItemCounts.failed > 0 && <span className="failed">{manualItemCounts.failed} falhas</span>}</div>{latestManual.error && <p className="triage-batch-error">{latestManual.error}</p>}<details className="triage-batch-log"><summary>Ver log do lote ({latestManualItems.length} vaga(s))</summary><ol>{latestManualItems.map((item) => <li key={item.jobId} className={item.status}><b>{batchItemStatus(item)}</b><span>{item.title} · {item.company}{item.externalId ? ` · código ${item.externalId}` : ""}</span><small>{item.attemptCount} tentativa(s) · atualização: {date(item.updatedAt)}{item.leaseUntil && item.status === "processing" ? ` · reserva até ${date(item.leaseUntil)}` : ""}</small>{item.error && <em>{item.error}</em>}</li>)}</ol></details></>}</div><div><button type="button" className="triage-card-action" disabled={syncingBatch} onClick={() => void syncManualBatch()}>{syncingBatch ? "Sincronizando…" : "Sincronizar agora"}</button>{recoverableManualItemCount > 0 && <button type="button" className="triage-card-action secondary" disabled={resumingBatch} onClick={() => void resumePendingBatch()}>{resumingBatch ? "Retomando…" : `Retomar ${recoverableManualItemCount} pendente(s)`}</button>}<button type="button" className="triage-card-action secondary" onClick={() => openHistory()}>Ver resultados</button></div></> : <p>Escolha o recorte acima e use a etapa 1. O andamento e o resultado aparecerão aqui.</p>}
        </section>
      </section>
    </div>
  );
}
