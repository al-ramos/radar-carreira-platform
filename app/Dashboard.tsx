"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import AlertCenter from "./AlertCenter";
import NotificationBell from "./NotificationBell";
import ImportRunReport from "./ImportRunReport";
import Analytics from "./Analytics";
import Monitoring from "./Monitoring";
import SourceList from "./SourceList";
import AuditTrail from "./AuditTrail";
import TriageReport from "./TriageReport";
import DataQuality from "./DataQuality";
import UserManagement from "./UserManagement";
import LinkedInExtension from "./LinkedInExtension";
import ApinfoExtension from "./ApinfoExtension";
import ProfilePreferences from "./ProfilePreferences";
import {
  emptyProfileChoices,
  normalizeCareerRules,
  ProfileChoices,
  SENIORITY_OPTIONS,
  SKILL_OPTIONS,
  WORK_MODE_OPTIONS,
} from "../lib/profile-options";
import { parseCareerSource } from "../lib/career-source";
import { isOwnerEmail } from "../lib/access";
import { analyzeStackFit, computeVerdict, VerdictResult } from "../lib/verdict";
import { buildApinfoApplicationEmail } from "../lib/application-email";
import { jobAreaLabel } from "../lib/job-area";
import { normalizeContactEmail } from "../lib/jobs";
import { AUTOMATIC_ACTION_STAGE, resolveAutomaticStage } from "../lib/pipeline-stage";
type Job = {
  id: string;
  score: number;
  scored: boolean;
  title: string;
  company: string;
  location: string;
  mode: string;
  seniority?: string;
  workMode?: string;
  age: string;
  publishedAt?: string;
  sourcePublishedAt?: string;
  firstSeenAt?: string;
  ingestionMode: "automatic" | "manual";
  ingestionChannel: "extension" | "email" | "connector" | "file" | "api";
  roleArea: string;
  sourceName?: string;
  url?: string;
  applyUrl?: string;
  contactEmail?: string;
  contactSubject?: string;
  externalId?: string;
  description?: string;
  stack: string[];
  reasons: string[];
  stage: string;
};
type ApiJob = {
  id: string;
  score?: number;
  scored?: boolean;
  title: string;
  company: string;
  location?: string;
  workMode?: string;
  seniority?: string;
  publishedAt?: string;
  sourcePublishedAt?: string;
  firstSeenAt?: string;
  ingestionMode?: "automatic" | "manual";
  ingestionChannel?: "extension" | "email" | "connector" | "file" | "api";
  roleArea?: string;
  sourceName?: string;
  url?: string;
  applyUrl?: string;
  contactEmail?: string | null;
  contactSubject?: string;
  externalId?: string;
  description?: string;
  stack?: string[];
  reasons?: string[];
};
type ApplicationStatus = "generated" | "sent" | "responded";
type JobIntelligence = {
  facts: {
    contract: string; languageRequirement: string; companyType: string; businessDomain: string;
    cultureSignals: string[]; ambiguities: string[]; evidence: Array<{ finding: string; excerpt: string }>;
  };
  interview: { anchor: string; gaps: string; questions: string[] };
  cached: boolean; provider: string; model: string;
};
type PipelineJob = ApiJob & {
  stage: string;
  note?: string;
  applicationStatus?: ApplicationStatus;
  generatedAt?: string;
  sentAt?: string;
  respondedAt?: string;
};
type CurrentUser = {
  displayName: string;
  email: string;
  fullName: string | null;
  role: "admin" | "user";
};
type JobDetail = {
  description: string;
  descriptionSource: string;
  stack?: string[];
  score?: number;
  reasons?: string[];
  scored?: boolean;
};
type CollectionOutcome = {
  id: string;
  name: string;
  status: "completed" | "failed";
  received: number;
  inserted: number;
  updated: number;
  error?: string;
};
type FilterOption = { id: string; label: string; count: number };
type ImportRunOption = { id: string; source: string; sourceId?: string | null; channel: string; startedAt: string; received: number; inserted: number; updated: number; jobs: number };
type JobFilterOptions = { sources: FilterOption[]; areas: FilterOption[]; channels: FilterOption[]; importRuns: ImportRunOption[] };
const JOBS_FETCH_ATTEMPTS = 2;
const JOBS_RETRY_BASE_DELAY_MS = 350;
const PROFILE_FETCH_TIMEOUT_MS = 8_000;
const JOBS_FETCH_TIMEOUT_MS = 10_000;
const APINFO_CONTACT_CAPTURE_TIMEOUT_MS = 4_000 * 5;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = JOBS_FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = window.setTimeout(
    () => controller.abort(new DOMException("Tempo limite excedido", "TimeoutError")),
    timeoutMs,
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Requisição cancelada", "AbortError"));
    }, { once: true });
  });
}

async function fetchJobsWithRetry(url: string, signal: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < JOBS_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, { cache: "no-store", signal });
      if (response.ok) return response.json();
      throw new Error(`Falha ao carregar vagas (HTTP ${response.status})`);
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      if (attempt + 1 < JOBS_FETCH_ATTEMPTS) {
        await waitForRetry(JOBS_RETRY_BASE_DELAY_MS * 2 ** attempt, signal);
      }
    }
  }
  const fallbackUrl = new URL(url, window.location.origin);
  fallbackUrl.searchParams.set("degraded", "1");
  try {
    const fallbackResponse = await fetchWithTimeout(fallbackUrl, { cache: "no-store", signal });
    if (fallbackResponse.ok) return fallbackResponse.json();
  } catch (error) {
    if (signal.aborted) throw error;
    lastError = error;
  }
  throw lastError;
}
const descriptionHeadings = new Set([
  "sobre a vaga",
  "about the job",
  "responsabilidades",
  "responsibilities",
  "requisitos",
  "requirements",
  "qualificações",
  "qualifications",
  "o que você fará",
  "o que buscamos",
  "diferenciais",
  "benefícios",
  "benefits",
]);
function decodeAndStrip(raw: string): string {
  // 1. Decodifica entidades HTML (duplo-codificadas ou simples)
  const decoded = raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  // 2. Substitui quebras de bloco HTML por newlines antes de remover tags
  const withBreaks = decoded
    .replace(/<\/?(p|div|h[1-6]|li|br|section|article)[^>]*>/gi, "\n")
    .replace(/<\/?(strong|b)>/gi, "**")
    .replace(/<[^>]+>/g, " ");
  // 3. Normaliza espaços
  return withBreaks.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function DescriptionContent({ text }: { text: string }) {
  const needsDecode = /&lt;|&amp;|&gt;|<[a-z]/i.test(text);
  const processed = needsDecode ? decodeAndStrip(text) : text;
  const clean = processed.replace(/[ \t]+/g, " ").trim(),
    marked = clean.replace(
      /\b(Sobre a vaga|About the job|Responsabilidades|Responsibilities|Requisitos|Requirements|Qualificações|Qualifications|O que você fará|O que buscamos|Diferenciais|Benefícios|Benefits)\b:?/gi,
      "\n$1\n",
    ),
    parts = marked
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean),
    blocks = parts.flatMap((part) => {
      if (descriptionHeadings.has(part.toLowerCase()))
        return [{ kind: "heading", text: part }];
      const sentences = part.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/);
      const grouped: string[] = [];
      for (let index = 0; index < sentences.length; index += 3)
        grouped.push(sentences.slice(index, index + 3).join(" "));
      return grouped.map((value) => ({ kind: "paragraph", text: value }));
    });
  function renderText(str: string) {
    // Renders **bold** markers from decoded <strong> tags
    const parts = str.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith("**") && part.endsWith("**")
        ? <strong key={i}>{part.slice(2, -2)}</strong>
        : part
    );
  }
  return (
    <div className="radar-description-content">
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <h5 key={`${block.text}-${index}`}>{block.text}</h5>
        ) : (
          <p key={index}>{renderText(block.text)}</p>
        ),
      )}
    </div>
  );
}
const demo: Job[] = [
  {
    id: "demo-1",
    score: 94,
    scored: true,
    title: "Senior Cloud Security Engineer",
    company: "Nubank",
    location: "Brasil",
    mode: "Remoto",
    age: "2h",
    stack: ["AWS", "Terraform", "Python"],
    reasons: ["Stack aderente", "Senioridade ideal", "Remoto"],
    stage: "Nova",
  },
  {
    id: "demo-2",
    score: 89,
    scored: true,
    title: "Security Operations Lead",
    company: "CloudWalk",
    location: "São Paulo",
    mode: "Híbrido",
    age: "4h",
    stack: ["SIEM", "SOC", "Splunk"],
    reasons: ["Área desejada", "Liderança", "Publicada hoje"],
    stage: "Nova",
  },
  {
    id: "demo-3",
    score: 84,
    scored: true,
    title: "DevSecOps Engineer",
    company: "Stone",
    location: "Brasil",
    mode: "Remoto",
    age: "6h",
    stack: ["Kubernetes", "CI/CD", "SAST"],
    reasons: ["DevSecOps", "Remoto", "Boa aderência"],
    stage: "Salva",
  },
  {
    id: "demo-4",
    score: 78,
    scored: true,
    title: "Cybersecurity Specialist",
    company: "Mercado Livre",
    location: "Osasco",
    mode: "Híbrido",
    age: "9h",
    stack: ["IAM", "Azure", "GRC"],
    reasons: ["Cybersecurity", "Senior", "Empresa-alvo"],
    stage: "Candidatura",
  },
];
const nav = [
  "Radar",
  "Pipeline",
  "Alertas",
  "Métricas",
  "Monitoramento",
  "Auditoria",
  "Triagem IA",
  "Qualidade",
  "Usuários",
  "Extensão LinkedIn",
  "Extensão APinfo",
  "Gmail RadarVagas",
  "Fontes",
  "Importações",
  "Configurações",
];
// sourceId não chega ao client (ApiJob/Job não o expõem), então aqui a
// checagem usa só a URL — o mesmo fallback que o backend usa quando
// sourceId não está preenchido. O link sintético gerado pela extensão do
// APinfo sempre aponta para apinfo.com.
const isApinfoJob = (job: Job) =>
  Boolean(job.url && /apinfo\.com/i.test(job.url));

/**
 * A busca de vagas do APinfo é um formulário method="post" — um link comum
 * com "?keyw=código" não funciona porque o parâmetro GET é simplesmente
 * ignorado pela página, que sempre abre a busca vazia. Para de fato levar
 * ao código da vaga, é preciso montar e submeter o mesmo POST que o próprio
 * formulário do site faz (confirmado inspecionando o DOM ao vivo:
 * keyw/onde/andor/pag são os campos usados na busca).
 */
function openApinfoJobSearch(codigo: string) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "https://www.apinfo.com/apinfo/inc/list4.cfm";
  form.target = "_blank";
  form.style.display = "none";
  const fields: Record<string, string> = {
    keyw: codigo,
    onde: "1",
    andor: "1",
    ddmmaa1: "",
    ddmmaa2: "",
    pag: "1",
  };
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

// Infere o provider da vaga pela URL para exibir o rótulo correto no botão
// de candidatura — sem necessidade de JOIN com a tabela de fontes.
function jobProviderLabel(job: Job): string {
  if (!job.url) return "Ver vaga";
  if (/linkedin\.com/i.test(job.url)) return "Candidatar via LinkedIn";
  if (/greenhouse\.io/i.test(job.url)) return "Candidatar via Greenhouse";
  if (/lever\.co/i.test(job.url)) return "Candidatar via Lever";
  if (/ashbyhq\.com/i.test(job.url)) return "Candidatar via Ashby";
  if (/gupy\.io/i.test(job.url)) return "Candidatar via Gupy";
  if (/quickin\.com\.br/i.test(job.url)) return "Candidatar via Quickin";
  return "Ver vaga ↗";
}
const adapt = (j: ApiJob): Job => ({
  id: j.id,
  score: j.score ?? 0,
  scored: j.scored ?? false,
  title: j.title,
  company: j.company,
  location: j.location ?? "Não informado",
  mode: j.workMode ?? "Não informado",
  seniority: j.seniority,
  age: (j.sourcePublishedAt ?? j.firstSeenAt)
    ? new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" }).format(
        -Math.max(
          1,
          Math.round((Date.now() - new Date(j.sourcePublishedAt ?? j.firstSeenAt!).getTime()) / 36e5),
        ),
        "hour",
      )
    : "recente",
  stack: Array.isArray(j.stack) ? j.stack : [],
  reasons:
    Array.isArray(j.reasons) && j.reasons.length
      ? j.reasons
      : ["Perfil ainda não personalizado"],
  stage: "Nova",
  url: j.url,
  applyUrl: j.applyUrl,
  contactEmail: normalizeContactEmail(j.contactEmail),
  contactSubject: j.contactSubject,
  externalId: j.externalId,
  publishedAt: j.publishedAt,
  sourcePublishedAt: j.sourcePublishedAt,
  firstSeenAt: j.firstSeenAt,
  ingestionMode: j.ingestionMode ?? "manual",
  ingestionChannel: j.ingestionChannel ?? "file",
  roleArea: j.roleArea ?? "other",
  sourceName: j.sourceName,
  description: j.description,
});

const formatJobDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
        new Date(value),
      )
    : "Não informada";

const formatJobDateTime = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "não informada";

const channelLabel = (channel: Job["ingestionChannel"]) => ({ extension: "Extensão", email: "E-mail", connector: "Coleta agendada", file: "Arquivo", api: "API" }[channel]);

/** Mantém a paginação navegável sem despejar dezenas de botões na tela. */
function compactPagination(current: number, total: number): Array<number | "start-ellipsis" | "end-ellipsis"> {
  if (total <= 5) return Array.from({ length: total }, (_, index) => index + 1);
  const middleStart = Math.max(2, Math.min(current - 1, total - 3));
  const middleEnd = Math.min(total - 1, middleStart + 2);
  const pages: Array<number | "start-ellipsis" | "end-ellipsis"> = [1];
  if (middleStart > 2) pages.push("start-ellipsis");
  for (let page = middleStart; page <= middleEnd; page += 1) pages.push(page);
  if (middleEnd < total - 1) pages.push("end-ellipsis");
  pages.push(total);
  return pages;
}
export default function Dashboard() {
  const [active, setActive] = useState("Radar"),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<Job[]>([]),
    [selected, setSelected] = useState<Job>(demo[0]),
    [fitFilter, setFitFilter] = useState<"profile" | number>(0),
    [requestedMinScore, setRequestedMinScore] = useState(0),
    [loadedMinScore, setLoadedMinScore] = useState(0),
    [sortOrder, setSortOrder] = useState<"score" | "recent">("score"),
    [viewMode, setViewMode] = useState<"cards" | "table">("cards"),
    // Controla só a visibilidade do painel de detalhe quando ele vira drawer
    // (viewMode === "table"). Não mexe em `selected`/`selectedJob` — outras
    // partes da tela (avanço automático, ações do pipeline) continuam
    // dependendo da última vaga vista normalmente.
    [tableDrawerOpen, setTableDrawerOpen] = useState(false),
    [simplifiedList, setSimplifiedList] = useState(false),
    [period, setPeriod] = useState<string | null>(null),
    [mode, setMode] = useState("loading"),
    [importing, setImporting] = useState(false),
    [sourcesOpen, setSourcesOpen] = useState(false),
    [pipelineOpen, setPipelineOpen] = useState(false),
    [pipelineItems, setPipelineItems] = useState<PipelineJob[]>([]),
    [pipelineLoading, setPipelineLoading] = useState(false),
    [sourceName, setSourceName] = useState(""),
    [provider, setProvider] = useState("greenhouse"),
    [careerUrl, setCareerUrl] = useState(""),
    [json, setJson] = useState(""),
    [importFile, setImportFile] = useState(""),
    [importCount, setImportCount] = useState(0),
    [message, setMessage] = useState(""),
    [sourceVersion, setSourceVersion] = useState(0),
    [jobsRefreshVersion, setJobsRefreshVersion] = useState(0),
    [profileRefreshVersion, setProfileRefreshVersion] = useState(0),
    [profileLoadFailed, setProfileLoadFailed] = useState(false),
    [loadError, setLoadError] = useState<string | null>(null);
  const [slugWarning, setSlugWarning] = useState<string[] | null>(null);
  const [collectionResults, setCollectionResults] = useState<
    CollectionOutcome[]
  >([]);
  const [totalJobs, setTotalJobs] = useState<number | null>(null);
  const [sourcesCount, setSourcesCount] = useState<number | null>(null);
  const loadedJobsRef = useRef<Job[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Quando o avanço automático de triagem precisa virar a página, sinaliza
   * para o efeito abaixo selecionar a primeira vaga assim que ela carregar. */
  const pendingAutoAdvanceRef = useRef(false);
  const [profileReady, setProfileReady] = useState(false);
  const [profileMasteredSkills, setProfileMasteredSkills] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [importRunFilter, setImportRunFilter] = useState("all");
  const [jobFilterOptions, setJobFilterOptions] = useState<JobFilterOptions>({ sources: [], areas: [], channels: [], importRuns: [] });
  const [ingestionMode, setIngestionMode] = useState<"all" | "automatic" | "manual">("all");
  const [receivedFrom, setReceivedFrom] = useState("");
  const [receivedTo, setReceivedTo] = useState("");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [profileMinScore, setProfileMinScore] = useState(60);
  const [gmailOpen, setGmailOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [linkedinOpen, setLinkedInOpen] = useState(false);
  const [apinfoOpen, setApinfoOpen] = useState(false);
  const [gmailSecret, setGmailSecret] = useState("");
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportOptionsOpen, setReportOptionsOpen] = useState(false);
  const [descriptionCopied, setDescriptionCopied] = useState(false);
  const [shareMenuJobId, setShareMenuJobId] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisSaving, setAnalysisSaving] = useState(false);
  const [jobIntelligence, setJobIntelligence] = useState<Record<string, JobIntelligence>>({});
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<{
    provider: { configured: boolean; provider: string | null; model: string | null };
    usage: { usedTokens: number; limit: number; remainingTokens: number; period: string };
  } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [importReportRunId, setImportReportRunId] = useState<string | null>(null);
  // Captura de contato do APinfo pedida à extensão a partir do próprio
  // Radar — ver captureApinfoContact/buildContactMailto e o useEffect que
  // escuta a resposta da extensão (RADAR_CAPTURE_CONTACT_RESULT).
  const [contactCapturing, setContactCapturing] = useState(false);
  const [contactPasteReady, setContactPasteReady] = useState(false);
  const [contactCaptureMsg, setContactCaptureMsg] = useState<{ text: string; error: boolean } | null>(null);
  const contactRequestRef = useRef<{ requestId: string; jobId: string } | null>(null);
  const contactRequestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Captura de contato do APinfo EM LOTE — ver captureApinfoContactsBatch e
  // o useEffect que escuta RADAR_CAPTURE_CONTACTS_BATCH_PROGRESS/_RESULT.
  // Pressupõe que a pessoa já está autenticada no APinfo no navegador (login
  // manual, como sempre foi); a extensão só abre abas em segundo plano com
  // essa sessão já existente, nunca solicita nem manipula credenciais.
  const [contactBatchState, setContactBatchState] = useState<{
    requestId: string;
    total: number;
    done: number;
    found: number;
    failed: number;
  } | null>(null);
  const contactBatchRequestIdRef = useRef<string | null>(null);
  /** Espelha `items` para uso dentro de listeners registrados uma única vez
   * (dependências vazias) — evita remover/re-registrar o listener de
   * RADAR_CAPTURE_CONTACTS_BATCH_* a cada vaga capturada, mesmo padrão já
   * usado por loadedJobsRef. */
  const itemsRef = useRef<Job[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  /**
   * Snapshot FIXO (externalId -> vaga) montado uma única vez quando o lote
   * começa (ver captureApinfoContactsBatch) — não usar itemsRef/items para
   * reencontrar a vaga a cada PROGRESS. O lote roda por minutos e "items"
   * pode ser substituído nesse meio tempo (refresh por visibilitychange,
   * troca de página, atualização de stack, etc.); se o lookup dependesse do
   * estado ao vivo, uma vaga ainda pendente podia deixar de ser encontrada e
   * o e-mail já capturado pela extensão seria descartado sem aviso — era a
   * causa real da intermitência ao salvar o e-mail em lote.
   */
  const contactBatchJobsRef = useRef<Map<string, Job>>(new Map());
  /** Quantas chamadas a saveApinfoContact (disparadas pelo lote) resolveram
   * como falha — ref, não state, porque o PATCH pode terminar depois do
   * RADAR_CAPTURE_CONTACTS_BATCH_RESULT (contactBatchState já virou null
   * nesse ponto) e um state preso a `current` perderia essa contagem. */
  const contactBatchSaveFailedRef = useRef(0);
  const pipelineUpdateRequestsRef = useRef(new Map<string, Promise<boolean>>());
  const applicationUpdateRequestsRef = useRef(new Map<string, Promise<boolean>>());
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [profileChoices, setProfileChoices] =
    useState<ProfileChoices>(emptyProfileChoices);
  const [pipelineFilter, setPipelineFilter] = useState<"all"|"unseen"|"viewed"|"saved"|"applied"|"interview"|"rejected">(() => {
    try { return (sessionStorage.getItem("radar_pipelineFilter") as "all"|"unseen"|"viewed"|"saved"|"applied"|"interview"|"rejected") ?? "all"; } catch { return "all"; }
  });
  const [verdictFilter, setVerdictFilter] = useState<"all"|"✅"|"🟡"|"🔴"|"❌">(() => {
    try { return (sessionStorage.getItem("radar_verdictFilter") as "all"|"✅"|"🟡"|"🔴"|"❌") ?? "all"; } catch { return "all"; }
  });
  /** Score mínimo efetivo — usado tanto para colorir o slider quanto para
   *  pedir ao servidor só as vagas que batem (mantém a paginação correta). */
  const effectiveMinScore =
    fitFilter === "profile" ? profileMinScore : fitFilter;
  // Arrastar o controle não deve iniciar uma consulta para cada ponto do
  // slider. Em Workers gratuitos, essas consultas concorrentes podem disputar
  // CPU e deixar a tela momentaneamente com a lista anterior filtrada pelo
  // novo valor (o enganoso "0 de 11.891").
  useEffect(() => {
    const timer = window.setTimeout(() => setRequestedMinScore(effectiveMinScore), 250);
    return () => window.clearTimeout(timer);
  }, [effectiveMinScore]);
  const scoreFilterPending = requestedMinScore !== effectiveMinScore || loadedMinScore !== requestedMinScore;
  const effectivePeriod = period;
  // O corte visual só muda depois que a API respondeu para aquele mesmo
  // valor. Assim, contagem, paginação e vagas sempre representam a mesma
  // consulta; enquanto isso, a interface informa que está atualizando.
  const visibleMinScore = simplifiedList ? 0 : loadedMinScore;
  const profileLoading = !profileReady || mode === "loading";
  const personalizationUnavailable = !profileLoading && simplifiedList;
  const personalizationPending = profileLoading || simplifiedList;
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);
  // ── Persistência de estado UI no sessionStorage (sobrevive ao F5) ──────────
  const jobListRef = useRef<HTMLDivElement>(null);
  const simplifiedRetryCountRef = useRef(0);
  const staleRetryCountRef = useRef(0);
  useEffect(() => { try { sessionStorage.setItem("radar_pipelineFilter", pipelineFilter); } catch {} }, [pipelineFilter]);
  useEffect(() => { try { sessionStorage.setItem("radar_verdictFilter", verdictFilter); } catch {} }, [verdictFilter]);
  useEffect(() => {
    if (selected?.id && !selected.id.startsWith("demo")) {
      try { sessionStorage.setItem("radar_selectedJobId", selected.id); } catch {}
    }
  }, [selected]);
  // Salva scroll da lista com throttle simples
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleJobListScroll() {
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = setTimeout(() => {
      try {
        const top = jobListRef.current?.scrollTop ?? 0;
        sessionStorage.setItem("radar_listScrollTop", String(top));
      } catch {}
    }, 200);
  }
  // ──────────────────────────────────────────────────────────────────────────
  const closeOpenOverlays = () => {
    setImporting(false);
    setImportReportRunId(null);
    setSourcesOpen(false);
    setPipelineOpen(false);
    setGmailOpen(false);
    setAlertsOpen(false);
    setAnalyticsOpen(false);
    setMonitorOpen(false);
    setAuditOpen(false);
    setQualityOpen(false);
    setUsersOpen(false);
    setLinkedInOpen(false);
    setApinfoOpen(false);
    setDetailJob(null);
    setPreferencesOpen(false);
    setReportOptionsOpen(false);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOpenOverlays();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  // A resposta simplificada é uma contingência breve. Tentamos recuperar a
  // personalização algumas vezes sem exigir que a pessoa recarregue a página.
  useEffect(() => {
    if (!simplifiedList) {
      simplifiedRetryCountRef.current = 0;
      return;
    }
    if (simplifiedRetryCountRef.current >= 3) return;
    const retryTimer = setTimeout(() => {
      simplifiedRetryCountRef.current += 1;
      setJobsRefreshVersion((version) => version + 1);
    }, 3_000);
    return () => clearTimeout(retryTimer);
  }, [simplifiedList, jobsRefreshVersion]);
  // A extensão coleta as vagas em outra aba e grava direto na API. Como ela
  // não compartilha o estado React deste Dashboard, recarregamos os totais ao
  // voltar para o Radar para não deixar a quantidade exibida defasada.
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshJobs = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () => setJobsRefreshVersion((version) => version + 1),
        300,
      );
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshJobs();
    };

    window.addEventListener("focus", refreshJobs);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      window.removeEventListener("focus", refreshJobs);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);
  // Busca por texto tem debounce: sem isso, cada tecla digitada dispararia
  // um fetch completo (o filtro de busca agora é aplicado no servidor).
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  /** Monta a querystring de filtros compartilhada entre a carga inicial e a
   *  troca de página — os dois precisam pedir exatamente os mesmos critérios
   *  para que a paginação numérica sempre bata com o total filtrado. */
  const buildJobsParams = useCallback(
    (page: number) => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (effectivePeriod) params.set("period", effectivePeriod);
      if (sourceFilter !== "all") params.set("sourceId", sourceFilter);
      if (areaFilter !== "all") params.set("area", areaFilter);
      if (channelFilter !== "all") params.set("channel", channelFilter);
      if (importRunFilter !== "all") params.set("importRun", importRunFilter);
      if (ingestionMode !== "all") params.set("ingestionMode", ingestionMode);
      if (receivedFrom) params.set("receivedFrom", new Date(receivedFrom).toISOString());
      if (receivedTo) params.set("receivedTo", new Date(receivedTo).toISOString());
      if (debouncedQuery) params.set("q", debouncedQuery);
      // Sempre pedimos o filtro que a pessoa escolheu, mesmo vindo de uma
      // resposta simplificada — quem decide se o pedido é atendido é o
      // servidor (via fetchJobsWithRetry + fallback ?degraded=1), não o
      // cliente. Omitir esses parâmetros enquanto simplifiedList=true fazia
      // a busca seguinte ter sucesso trivial e "curar" o modo simplificado
      // sozinha, disparando de novo a busca completa em loop infinito.
      if (requestedMinScore > 0) params.set("minScore", String(requestedMinScore));
      if (pipelineFilter !== "all") params.set("pipeline", pipelineFilter);
      if (verdictFilter !== "all") params.set("verdict", verdictFilter);
      params.set("sort", sortOrder === "recent" ? "imported" : "score");
      return params.toString();
    },
    [effectivePeriod, sourceFilter, areaFilter, channelFilter, importRunFilter, ingestionMode, receivedFrom, receivedTo, debouncedQuery, requestedMinScore, pipelineFilter, verdictFilter, sortOrder],
  );
  useEffect(() => {
    if (!profileReady || profileLoadFailed) return;
    const controller = new AbortController();
    let staleRetryTimer: ReturnType<typeof setTimeout> | null = null;
    fetchJobsWithRetry(`/api/jobs?${buildJobsParams(1)}`, controller.signal)
      .then((data) => {
        const next = (data.jobs ?? [])
          .map(adapt)
          .sort((a: Job, b: Job) => sortOrder === "recent"
            ? new Date(b.firstSeenAt ?? 0).getTime() - new Date(a.firstSeenAt ?? 0).getTime()
            : b.score - a.score);
        loadedJobsRef.current = next;
        setItems(next);
        setCurrentPage(1);
        if (next.length) {
          try {
            const savedId = sessionStorage.getItem("radar_selectedJobId");
            const restored = savedId ? next.find((j: Job) => j.id === savedId) : null;
            const first = restored ?? next[0];
            setSelected(first);
            void loadJobDetail(first);
          } catch {
            setSelected(next[0]);
            void loadJobDetail(next[0]);
          }
        }
        setTotalJobs(typeof data.total === "number" ? data.total : next.length);
        setSourcesCount(typeof data.sourcesCount === "number" ? data.sourcesCount : null);
        if (data.filterOptions) setJobFilterOptions(data.filterOptions);
        setPeriod((current) => current ?? String(data.period ?? "24"));
        setLoadedMinScore(requestedMinScore);
        setSimplifiedList(Boolean(data.degraded));
        setMode("database");
        setLoadError(null);
        staleRetryCountRef.current = 0;
        setMessage((current) => {
          if (data.degraded) {
            return "Exibindo a lista em modo simplificado enquanto a personalização se recupera.";
          }
          return current.startsWith("O Radar está temporariamente indisponível.") ||
            current.startsWith("Não foi possível atualizar agora.")
            ? ""
            : current;
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        if (loadedJobsRef.current.length) {
          setMode("database");
          setMessage("Não foi possível atualizar agora. A lista anterior pode estar desatualizada; nova tentativa automática em instantes.");
          if (staleRetryCountRef.current < 3) {
            staleRetryCountRef.current += 1;
            staleRetryTimer = setTimeout(() => setJobsRefreshVersion((version) => version + 1), 3_000);
          }
          return;
        }
        setMode("unavailable");
        setLoadError("Não foi possível carregar as vagas dentro do tempo esperado.");
        setMessage("O Radar está temporariamente indisponível. Tentaremos novamente automaticamente.");
        if (staleRetryCountRef.current < 3) {
          staleRetryCountRef.current += 1;
          staleRetryTimer = setTimeout(() => setJobsRefreshVersion((version) => version + 1), 3_000);
        }
      });
    return () => {
      controller.abort();
      if (staleRetryTimer) clearTimeout(staleRetryTimer);
    };
  }, [effectivePeriod, sourceFilter, debouncedQuery, requestedMinScore, pipelineFilter, verdictFilter, sortOrder, buildJobsParams, jobsRefreshVersion, profileReady, profileLoadFailed]);
  useEffect(() => {
    const controller = new AbortController();
    fetchWithTimeout("/api/profile", { cache: "no-store", signal: controller.signal }, PROFILE_FETCH_TIMEOUT_MS)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setProfileLoadFailed(false);
        setCurrentUser(data.user);
        setProfileMinScore(Number(data.profile?.minScore ?? 60));
        if (Array.isArray(data.profile?.masteredSkills)) {
          setProfileMasteredSkills(data.profile.masteredSkills as string[]);
        }
        if (data.profile) {
          setProfileChoices({
            seniority: Array.isArray(data.profile.seniority) ? data.profile.seniority : [],
            preferredMode: Array.isArray(data.profile.preferredMode) ? data.profile.preferredMode.filter((mode: string) => WORK_MODE_OPTIONS.includes(mode)) : [],
            masteredSkills: Array.isArray(data.profile.masteredSkills) ? data.profile.masteredSkills : [],
            desiredAreas: Array.isArray(data.profile.desiredAreas) ? data.profile.desiredAreas : [],
            avoidTerms: Array.isArray(data.profile.avoidTerms) ? data.profile.avoidTerms : [],
            minScore: Number(data.profile.minScore ?? 60),
            careerRules: normalizeCareerRules(data.profile.careerRules),
          });
        }
        // Carrega pipeline automaticamente ao confirmar usuário autenticado
        if (data.user) {
          fetchWithTimeout("/api/pipeline", { cache: "no-store", signal: controller.signal }, PROFILE_FETCH_TIMEOUT_MS)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d) => setPipelineItems(d.items ?? []))
            .catch((err) => {
              // Log em dev para diagnóstico — não bloqueia a UI
              if (typeof window !== "undefined" && window.location.hostname === "localhost") {
                console.error("[radar] pipeline auto-load falhou:", err);
              }
            });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted && error instanceof DOMException && error.name === "AbortError") return;
        setCurrentUser(null);
        setProfileLoadFailed(true);
        setMode("unavailable");
        setLoadError("Não foi possível carregar seu perfil dentro do tempo esperado.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setProfileReady(true);
      });
    return () => controller.abort();
  }, [profileRefreshVersion]);
  // Restaura scroll da lista após os jobs carregarem
  useEffect(() => {
    if (!items.length || mode === "preview") return;
    try {
      const savedTop = Number(sessionStorage.getItem("radar_listScrollTop") ?? "0");
      if (savedTop > 0 && jobListRef.current) {
        // requestAnimationFrame garante que o DOM já renderizou
        requestAnimationFrame(() => {
          if (jobListRef.current) jobListRef.current.scrollTop = savedTop;
        });
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const stackFilterOptions = useMemo(
    () =>
      [
        ...new Set([...SKILL_OPTIONS, ...items.flatMap((job) => job.stack)]),
      ].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [items],
  );
  /** Mapa jobId → stage para filtragem rápida do pipeline no radar */
  const pipelineStageMap = useMemo(() => {
    const map = new Map<string, string>();
    pipelineItems.forEach((item) => map.set(item.id, item.stage));
    return map;
  }, [pipelineItems]);

  /** Mapa jobId → VerdictResult (calculado uma vez por lista carregada).
   *  Retorna mapa vazio se o usuário não configurou skills no perfil. */
  const verdictMap = useMemo(() => {
    if (profileMasteredSkills.length === 0) return new Map<string, VerdictResult>();
    const map = new Map<string, VerdictResult>();
    items.forEach((job) => {
      // O veredito só complementa uma aderência calculada. Vagas fora do
      // escopo técnico ficam sem score e não podem receber, por acidente,
      // um "Bate" baseado apenas em modalidade, idioma ou senioridade.
      if (!job.scored) return;
      map.set(job.id, computeVerdict({
        title: job.title,
        description: job.description ?? "",
        stack: job.stack,
        seniority: job.seniority,
        workMode: job.workMode,
        location: job.location,
      }, profileMasteredSkills, profileChoices.careerRules));
    });
    return map;
  }, [items, profileMasteredSkills, profileChoices.careerRules]);
  /** Cor do trilho do slider — mesmos limiares usados no score das vagas. */
  const fitFilterColor =
    effectiveMinScore >= 80 ? "#2e6b3e" : effectiveMinScore >= 60 ? "#7a6200" : effectiveMinScore > 0 ? "#b04a1a" : "#173f32";
  /** Posição do polegar do slider nativo (múltiplo de 10; "profile" arredonda). */
  const fitFilterSliderValue =
    fitFilter === "profile" ? Math.round(profileMinScore / 10) * 10 : fitFilter;
  const activeFilterChips: Array<{ id: string; label: string; remove: () => void }> = [];
  if (sourceFilter !== "all") {
    activeFilterChips.push({
      id: "source",
      label: jobFilterOptions.sources.find(option => option.id === sourceFilter)?.label ?? "Fonte selecionada",
      remove: () => setSourceFilter("all"),
    });
  }
  if (areaFilter !== "all") activeFilterChips.push({ id: "area", label: jobFilterOptions.areas.find(option => option.id === areaFilter)?.label ?? "Área selecionada", remove: () => setAreaFilter("all") });
  if (channelFilter !== "all") activeFilterChips.push({ id: "channel", label: jobFilterOptions.channels.find(option => option.id === channelFilter)?.label ?? "Canal selecionado", remove: () => setChannelFilter("all") });
  if (importRunFilter !== "all") {
    const run = jobFilterOptions.importRuns.find(option => option.id === importRunFilter);
    activeFilterChips.push({ id: "import-run", label: run ? `${run.source} · ${formatJobDateTime(run.startedAt)}` : "Importação selecionada", remove: () => setImportRunFilter("all") });
  }
  if (ingestionMode !== "all") {
    activeFilterChips.push({
      id: "ingestion",
      label: ingestionMode === "automatic" ? "Importação automática" : "Importação manual",
      remove: () => setIngestionMode("all"),
    });
  }
  if (receivedFrom) {
    activeFilterChips.push({
      id: "received-from",
      label: `Recebida desde ${formatJobDateTime(new Date(receivedFrom).toISOString())}`,
      remove: () => setReceivedFrom(""),
    });
  }
  if (receivedTo) {
    activeFilterChips.push({
      id: "received-to",
      label: `Recebida até ${formatJobDateTime(new Date(receivedTo).toISOString())}`,
      remove: () => setReceivedTo(""),
    });
  }
  if (effectivePeriod && effectivePeriod !== "all") {
    activeFilterChips.push({
      id: "period",
      label: effectivePeriod === "24" ? "Últimas 24h" : effectivePeriod === "72" ? "Últimos 3 dias" : "Últimos 7 dias",
      remove: () => handlePeriodChange("all"),
    });
  }
  if (pipelineFilter !== "all") {
    const pipelineLabels = { unseen: "Não vistas", viewed: "Vistas", saved: "Salvas", applied: "Candidaturas", interview: "Entrevistas", rejected: "Encerradas" } as const;
    activeFilterChips.push({ id: "pipeline", label: pipelineLabels[pipelineFilter], remove: () => setPipelineFilter("all") });
  }
  if (!personalizationPending && verdictFilter !== "all") {
    const verdictLabels = { "✅": "Bate", "🟡": "Provável", "🔴": "Não bate", "❌": "Bloqueado" } as const;
    activeFilterChips.push({ id: "verdict", label: `${verdictFilter} ${verdictLabels[verdictFilter]}`, remove: () => setVerdictFilter("all") });
  }
  if (!personalizationPending && fitFilter !== 0) {
    activeFilterChips.push({
      id: "fit",
      label: fitFilter === "profile" ? `Meu perfil (${profileMinScore}%)` : `Aderência ${fitFilter}%+`,
      remove: () => setFitFilter(0),
    });
  }
  const activeFilterCount = activeFilterChips.length;
  const filtered = useMemo(
    () =>
      items.filter((j) => {
        // A busca principal promete código, cargo, empresa ou tecnologia. Não usamos a
        // descrição aqui: palavras comuns no texto longo (como "squad") faziam
        // parecer que o campo não estava filtrando a lista.
        const text = `${j.externalId ?? ""} ${j.title} ${j.company} ${j.location} ${j.seniority ?? ""} ${j.stack.join(" ")}`.toLowerCase();
        const searchQuery = query.trim().toLowerCase();
        return (
          j.score >= visibleMinScore &&
          (!searchQuery || text.includes(searchQuery)) &&
          (pipelineFilter === "all" ||
            (pipelineFilter === "unseen"
              ? !pipelineStageMap.has(j.id)
              : pipelineStageMap.get(j.id) === pipelineFilter)) &&
          (personalizationPending || verdictFilter === "all" || verdictMap.get(j.id)?.emoji === verdictFilter)
        );
      }),
    [
      items,
      query,
      visibleMinScore,
      pipelineFilter,
      pipelineStageMap,
      verdictFilter,
      verdictMap,
      personalizationPending,
    ],
  );
  const orderedJobs = useMemo(
    () => [...filtered].sort((left, right) => {
      if (sortOrder === "recent") {
        return new Date(right.firstSeenAt ?? 0).getTime() - new Date(left.firstSeenAt ?? 0).getTime();
      }
      return right.score - left.score || new Date(right.publishedAt ?? 0).getTime() - new Date(left.publishedAt ?? 0).getTime();
    }),
    [filtered, sortOrder],
  );
  /** Ordenação da visão em tabela — independente do "Ordenar por" dos cards,
   * clicar num cabeçalho de coluna ordena só a tabela. Opera sobre a mesma
   * `orderedJobs` (já filtrada pelos controles da tela), então herda busca,
   * aderência mínima, período etc. automaticamente. */
  const [tableSort, setTableSort] = useState<{ column: "company" | "title" | "score" | "stack" | "location" | "source" | "publishedAt"; direction: "asc" | "desc" }>(
    { column: "score", direction: "desc" },
  );
  const toggleTableSort = useCallback((column: typeof tableSort.column) => {
    setTableSort((current) =>
      current.column === column
        ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column, direction: column === "score" || column === "publishedAt" ? "desc" : "asc" },
    );
  }, []);
  /** Filtro por coluna da tabela — texto livre em Empresa/Vaga/Stack, exato
   * em Modalidade/Veredito/Fonte. Roda em cima da página já carregada
   * (client-side), não chama a API de novo. */
  const [tableColumnFilters, setTableColumnFilters] = useState<{
    company: string; title: string; mode: string; verdict: string; stack: string; source: string;
  }>({ company: "", title: "", mode: "", verdict: "", stack: "", source: "" });
  const setTableColumnFilter = useCallback((column: keyof typeof tableColumnFilters, value: string) => {
    setTableColumnFilters((current) => ({ ...current, [column]: value }));
  }, []);
  const clearTableColumnFilters = useCallback(() => {
    setTableColumnFilters({ company: "", title: "", mode: "", verdict: "", stack: "", source: "" });
  }, []);
  const activeTableColumnFilterCount = Object.values(tableColumnFilters).filter(Boolean).length;
  const tableJobs = useMemo(() => {
    const { column, direction } = tableSort;
    const factor = direction === "asc" ? 1 : -1;
    const filters = tableColumnFilters;
    const filtered = filters.company || filters.title || filters.mode || filters.verdict || filters.stack || filters.source
      ? orderedJobs.filter((j) => {
          if (filters.company && !j.company.toLowerCase().includes(filters.company.toLowerCase())) return false;
          if (filters.title && !j.title.toLowerCase().includes(filters.title.toLowerCase())) return false;
          if (filters.mode && j.mode !== filters.mode) return false;
          if (filters.verdict) {
            const v = verdictMap.get(j.id);
            const key = v ? (v.emoji === "✅" ? "ok" : v.emoji === "🟡" ? "maybe" : v.emoji === "🔴" ? "no" : "blocked") : "none";
            if (key !== filters.verdict) return false;
          }
          if (filters.stack && !j.stack.some((s) => s.toLowerCase().includes(filters.stack.toLowerCase()))) return false;
          if (filters.source && (j.sourceName ?? "") !== filters.source) return false;
          return true;
        })
      : orderedJobs;
    return [...filtered].sort((left, right) => {
      switch (column) {
        case "score":
          return (left.score - right.score) * factor;
        case "stack":
          return (left.stack[0] ?? "").localeCompare(right.stack[0] ?? "", "pt-BR") * factor;
        case "location":
          return left.location.localeCompare(right.location, "pt-BR") * factor;
        case "source":
          return (left.sourceName ?? "").localeCompare(right.sourceName ?? "", "pt-BR") * factor;
        case "publishedAt":
          return (new Date(left.sourcePublishedAt ?? 0).getTime() - new Date(right.sourcePublishedAt ?? 0).getTime()) * factor;
        default:
          return left[column].localeCompare(right[column], "pt-BR") * factor;
      }
    });
  }, [orderedJobs, tableSort, tableColumnFilters, verdictMap]);
  /** Opções distintas para os filtros de coluna do tipo "select" (Modalidade
   * e Fonte), derivadas da página de vagas já carregada. */
  const tableModeOptions = useMemo(
    () => Array.from(new Set(orderedJobs.map((j) => j.mode).filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [orderedJobs],
  );
  const tableSourceOptions = useMemo(
    () => Array.from(new Set(orderedJobs.map((j) => j.sourceName).filter((s): s is string => Boolean(s)))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [orderedJobs],
  );
  /** Quantas vagas do APinfo, entre as visíveis com os filtros atuais, ainda
   * não têm contactEmail — usado para mostrar (e habilitar) o botão de
   * captura em lote só quando há algo genuinamente pendente. Mesma base
   * (orderedJobs) usada por captureApinfoContactsBatch, para o número no
   * botão sempre bater com o que ele de fato processa. */
  const apinfoContactsPendingCount = useMemo(
    () => orderedJobs.filter((j) => isApinfoJob(j) && !j.contactEmail && j.applyUrl).length,
    [orderedJobs],
  );
  const sortReportJobs = useCallback((jobs: Job[]) =>
    [...jobs].sort((left, right) => {
      if (sortOrder === "recent") {
        return new Date(right.firstSeenAt ?? 0).getTime() - new Date(left.firstSeenAt ?? 0).getTime();
      }
      return right.score - left.score || new Date(right.publishedAt ?? 0).getTime() - new Date(left.publishedAt ?? 0).getTime();
    }),
  [sortOrder]);

  /** Busca todas as páginas com os filtros em vigor antes de exportar. */
  async function getAllReportJobs(): Promise<Job[]> {
    const pageSize = 250;
    const loadPage = async (page: number) => {
      const params = new URLSearchParams(buildJobsParams(page));
      params.set("limit", String(pageSize));
      const data = await fetchJobsWithRetry(`/api/jobs?${params.toString()}`, new AbortController().signal);
      return { jobs: (data.jobs ?? []).map(adapt) as Job[], total: Number(data.total ?? 0) };
    };
    const firstPage = await loadPage(1);
    const pages = Math.ceil(firstPage.total / pageSize);
    const allJobs = [...firstPage.jobs];
    for (let page = 2; page <= pages; page += 1) {
      const result = await loadPage(page);
      allJobs.push(...result.jobs);
    }
    return sortReportJobs(allJobs);
  }

  /** Baixa a página atual ou todas as páginas que correspondem aos filtros. */
  async function downloadReport(scope: "page" | "all") {
    if (reportLoading) return;
    setReportOptionsOpen(false);
    if (scope === "page" && orderedJobs.length === 0) {
      setMessage("A página atual não possui vagas para exportar. Ajuste ou limpe os filtros e tente novamente.");
      return;
    }
    setReportLoading(true);
    try {
      const jobsToExport = scope === "page" ? orderedJobs : await getAllReportJobs();
      if (jobsToExport.length === 0) {
        setMessage("Não há vagas para exportar com os filtros atuais.");
        return;
      }
      const rows = jobsToExport.map((job) => {
        const verdict = verdictMap.get(job.id) ?? (
          job.scored && profileMasteredSkills.length
            ? computeVerdict({
                title: job.title,
                description: job.description ?? "",
                stack: job.stack,
                seniority: job.seniority,
                workMode: job.workMode,
                location: job.location,
              }, profileMasteredSkills, profileChoices.careerRules)
            : undefined
        );
        return {
          id: job.id,
          score: job.score,
          verdict: verdict ? `${verdict.emoji} ${verdict.label}` : undefined,
        };
      });
      const response = await fetch("/api/admin/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!response.ok) {
        setMessage("Não foi possível gerar o relatório. Tente novamente.");
        return;
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `radar-vagas-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setMessage(`${jobsToExport.length} vaga${jobsToExport.length !== 1 ? "s" : ""} exportada${jobsToExport.length !== 1 ? "s" : ""} com sucesso.`);
    } catch {
      setMessage("Não foi possível gerar o relatório. Tente novamente.");
    } finally {
      setReportLoading(false);
    }
  }
  const selectedJob =
    filtered.find((job) => job.id === selected.id) ?? orderedJobs[0] ?? null;
  const selectedJobVerdict = selectedJob && selectedJob.scored && profileMasteredSkills.length
    ? computeVerdict({
        title: selectedJob.title,
        description: (!detailLoading && jobDetail?.description) || selectedJob.description || "",
        stack: (!detailLoading && jobDetail?.stack?.length) ? jobDetail.stack : selectedJob.stack,
        seniority: selectedJob.seniority,
        workMode: selectedJob.workMode,
        location: selectedJob.location,
      }, profileMasteredSkills, profileChoices.careerRules)
    : null;
  const selectedJobEligible = selectedJobVerdict?.emoji === "✅" || selectedJobVerdict?.emoji === "🟡";
  const selectedJobRejected = Boolean(selectedJobVerdict && !selectedJobEligible);
  const selectedApplication = selectedJob ? pipelineItems.find(item => item.id === selectedJob.id) : undefined;
  function clearRadarFilters() {
    setQuery("");
    setFitFilter(0);
    setPeriod("all");
    setSortOrder("recent");
    setSourceFilter("all");
    setAreaFilter("all");
    setChannelFilter("all");
    setImportRunFilter("all");
    setIngestionMode("all");
    setReceivedFrom("");
    setReceivedTo("");
    setPipelineFilter("all");
    setVerdictFilter("all");
  }
  /**
   * A janela "Todas" nunca fica bloqueada. Para manter a consulta leve e a
   * ordenação honesta, ela desliga os filtros que exigem calcular score em
   * memória e passa a listar o banco por importação recente.
   */
  function handlePeriodChange(nextPeriod: string) {
    setPeriod(nextPeriod);
    if (nextPeriod === "all") {
      setSortOrder("recent");
      setFitFilter(0);
      setVerdictFilter("all");
    }
  }
  function handleSortOrderChange(nextSort: "score" | "recent") {
    setSortOrder(nextSort);
    if (nextSort === "score" && period === "all") setPeriod("24");
  }
  function handleFitFilterChange(nextFilter: "profile" | number) {
    setFitFilter(nextFilter);
    if (nextFilter !== 0 && period === "all") setPeriod("24");
  }
  function handleVerdictFilterChange(nextVerdict: typeof verdictFilter) {
    setVerdictFilter(nextVerdict);
    if (nextVerdict !== "all" && period === "all") setPeriod("24");
  }
  function retryRadarLoad() {
    setLoadError(null);
    setMode("loading");
    setProfileReady(false);
    setProfileLoadFailed(false);
    setProfileRefreshVersion((version) => version + 1);
  }
  async function goToJobsPage(page: number) {
    if (page === currentPage || page < 1) return;
    setLoadingMore(true);
    try {
      const controller = new AbortController();
      const data = await fetchJobsWithRetry(`/api/jobs?${buildJobsParams(page)}`, controller.signal);
      const next: Job[] = (data.jobs ?? []).map(adapt).sort((a: Job, b: Job) => sortOrder === "recent"
        ? new Date(b.firstSeenAt ?? 0).getTime() - new Date(a.firstSeenAt ?? 0).getTime()
        : b.score - a.score);
      setItems(next);
      setCurrentPage(page);
      setSimplifiedList(Boolean(data.degraded));
      jobListRef.current?.scrollTo({ top: 0 });
    } catch {
      setMessage("Não foi possível trocar de página agora. Tente novamente em instantes.");
    } finally {
      setLoadingMore(false);
    }
  }
  async function runImport() {
    setMessage("Importando…");
    try {
      const csv = !json.trim().startsWith("[") && !json.trim().startsWith("{"),
        response = await fetch("/api/admin/import", {
          method: "POST",
          headers: { "content-type": csv ? "text/csv" : "application/json" },
          body: json,
        });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha na importação");
      setMessage(`${data.inserted} novas e ${data.updated} atualizadas.`);
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Falha na importação");
    }
  }
  async function loadImportFile(file: File) {
    if (file.size > 2_000_000) {
      setMessage("O arquivo excede o limite de 2 MB.");
      return;
    }
    try {
      const content = await file.text(),
        isJson = file.name.toLowerCase().endsWith(".json");
      let count = 0;
      if (isJson) {
        const parsed = JSON.parse(content) as unknown;
        const rows = Array.isArray(parsed)
          ? parsed
          : parsed &&
            typeof parsed === "object" &&
            (parsed as { jobs?: unknown }).jobs;
        count = Array.isArray(rows) ? rows.length : 0;
      } else
        count = Math.max(0, content.split(/\r?\n/).filter(Boolean).length - 1);
      if (!count) throw new Error("Nenhuma vaga encontrada");
      setJson(content);
      setImportFile(file.name);
      setImportCount(count);
      setMessage("");
    } catch (e) {
      setJson("");
      setImportFile("");
      setImportCount(0);
      setMessage(
        e instanceof Error ? e.message : "Não foi possível ler o arquivo.",
      );
    }
  }
  function clearImportFile() {
    setJson("");
    setImportFile("");
    setImportCount(0);
    setMessage("");
  }
  function updateCareerUrl(value: string) {
    setCareerUrl(value);
    try {
      const source = parseCareerSource(value);
      setProvider(source.provider);
      if (!sourceName) setSourceName(source.suggestedName);
      setMessage("");
    } catch {}
  }
  async function addSource(test = false, forceAdd = false) {
    setSlugWarning(null);
    setMessage(test ? "Testando página de carreiras…" : "Salvando fonte…");
    const r = await fetch("/api/admin/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: sourceName, provider, careerUrl, test, forceAdd }),
      }),
      data = await r.json();
    if (!r.ok && data.warning === "slug_ambiguous") {
      setSlugWarning(data.reasons ?? []);
      setMessage("");
      return;
    }
    if (r.ok) setSourceVersion((version) => version + 1);
    setMessage(
      r.ok
        ? test
          ? `Fonte encontrada; ${data.available} vagas disponíveis. Coleta ainda não foi iniciada.`
          : "Fonte cadastrada. Agora você pode coletar as vagas."
        : (data.error ?? "Falha ao cadastrar"),
    );
  }
  async function collectNow(catalogId?: string, companyName?: string) {
    setMessage(
      catalogId
        ? `Iniciando coleta de ${companyName}…`
        : "Coletando vagas nas fontes automáticas…",
    );
    setCollectionResults([]);
    let offset = 0;
    const allOutcomes: CollectionOutcome[] = [];
    let received = 0, inserted = 0, updated = 0, errors = 0;
    do {
      const r = await fetch("/api/admin/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(catalogId ? { catalogId } : { offset }),
      });
      const data = await r.json();
      if (!r.ok) {
        setMessage(data.error ?? "Falha na coleta");
        return;
      }
      if (data.message) {
        setMessage(data.message);
        return;
      }
      received += data.received ?? 0;
      inserted += data.inserted ?? 0;
      updated += data.updated ?? 0;
      errors += data.errors ?? 0;
      allOutcomes.push(...(data.outcomes ?? []));
      setCollectionResults([...allOutcomes]);
      if (data.nextOffset == null) break;
      offset = data.nextOffset;
      setMessage(`Coletando fontes: ${data.processed} de ${data.totalSources} concluídas…`);
    } while (!catalogId);
    const result = `${received} encontradas: ${inserted} novas e ${updated} atualizadas.`;
    setMessage(errors ? `${result} ${errors} fonte(s) falharam — consulte Monitoramento.` : result);
    setSourceVersion((version) => version + 1);
    const jobsResponse = await fetch(`/api/jobs?${buildJobsParams(1)}`);
    if (jobsResponse.ok) {
      const jobsData = await jobsResponse.json();
      const next = (jobsData.jobs ?? [])
        .map(adapt)
        .sort((a: Job, b: Job) => b.score - a.score);
      setItems(next);
      setCurrentPage(1);
      if (next.length) setSelected(next[0]);
      setTotalJobs(
        typeof jobsData.total === "number" ? jobsData.total : next.length,
      );
      setSourcesCount(typeof jobsData.sourcesCount === "number" ? jobsData.sourcesCount : null);
      if (jobsData.filterOptions) setJobFilterOptions(jobsData.filterOptions);
    }
  }
  async function activateCatalog() {
    setMessage("Ativando as empresas do catálogo…");
    const response = await fetch("/api/admin/sources", { method: "PUT" });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "Não foi possível ativar o catálogo.");
      return;
    }
    setMessage(`${data.added} empresas ativadas${data.reactivated ? ` e ${data.reactivated} reativadas` : ""}. Agora use “Coletar todas” para iniciar a coleta em lote.`);
    setSourceVersion((version) => version + 1);
  }
  async function openProfile() {
    setPreferencesOpen(true);
    const [r, aiResponse] = await Promise.all([fetch("/api/profile"), fetch("/api/ai/status")]);
    if (aiResponse.ok) setAiStatus(await aiResponse.json());
    if (r.ok) {
      const d = await r.json(),
        p = d.profile;
      setProfileChoices({
        seniority: Array.isArray(p.seniority) ? p.seniority : [],
        preferredMode: Array.isArray(p.preferredMode)
          ? p.preferredMode.filter((mode: string) =>
              WORK_MODE_OPTIONS.includes(mode),
            )
          : [],
        masteredSkills: Array.isArray(p.masteredSkills) ? p.masteredSkills : [],
        desiredAreas: Array.isArray(p.desiredAreas) ? p.desiredAreas : [],
        avoidTerms: Array.isArray(p.avoidTerms) ? p.avoidTerms : [],
        minScore: p.minScore ?? 60,
        careerRules: normalizeCareerRules(p.careerRules),
      });
    }
  }
  async function saveProfile() {
    const r = await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profileChoices),
    });
    const data = await r.json().catch(() => null);
    setMessage(
      r.ok
        ? "Preferências salvas. Recalculando seu radar…"
        : data?.error ?? "Não foi possível salvar as preferências.",
    );
    if (r.ok) {
      const savedMinScore = Number(data?.profile?.minScore ?? profileChoices.minScore);
      setProfileMinScore(savedMinScore);
      setProfileChoices((current) => ({ ...current, minScore: savedMinScore }));
      handleFitFilterChange("profile");
      setTimeout(() => location.reload(), 900);
    }
  }
  /** Seleciona uma vaga, carrega descrição enriquecida e registra visualização no pipeline */
  function selectJob(job: Job) {
    setSelected(job);
    setAnalysisOpen(false);
    setTableDrawerOpen(true);
    void loadJobDetail(job);
    if (!job.id.startsWith("demo") && currentUser) {
      void updateStage(job.id, AUTOMATIC_ACTION_STAGE.view, undefined, "advance");
    }
  }
  /**
   * Triagem sequencial: ao concluir uma ação de análise sobre a vaga aberta
   * (Candidatar, Analisar candidatura, Encaminhar), pula automaticamente para
   * a próxima vaga da lista. Se a vaga atual for a última da página, avança
   * para a próxima página e seleciona a primeira vaga assim que ela chegar.
   */
  function advanceToNextJob() {
    if (!selectedJob) return;
    const index = orderedJobs.findIndex((job) => job.id === selectedJob.id);
    if (index === -1) return;
    const next = orderedJobs[index + 1];
    if (next) {
      selectJob(next);
      return;
    }
    const totalPages = totalJobs != null ? Math.ceil(totalJobs / 50) : currentPage;
    if (currentPage >= totalPages) {
      setMessage("Você chegou ao fim da lista de vagas.");
      return;
    }
    pendingAutoAdvanceRef.current = true;
    void goToJobsPage(currentPage + 1);
  }
  // Conclui o avanço automático de triagem quando a nova página termina de carregar.
  useEffect(() => {
    if (!pendingAutoAdvanceRef.current) return;
    if (loadingMore) return;
    pendingAutoAdvanceRef.current = false;
    if (orderedJobs.length > 0) window.setTimeout(() => selectJob(orderedJobs[0]), 0);
  }, [loadingMore, orderedJobs]);
  /** Atualiza o dropdown imediatamente e consolida uma única gravação no servidor. */
  function updateStage(jobId: string, stage: string, toast?: string, mode: "replace" | "advance" = "replace") {
    const requestKey = `${jobId}:${stage}:${mode}`;
    const pending = pipelineUpdateRequestsRef.current.get(requestKey);
    if (pending) return pending;

    const previous = pipelineItems.find((item) => item.id === jobId);
    const optimisticStage = mode === "advance" && (stage === "viewed" || stage === "saved" || stage === "applied")
      ? resolveAutomaticStage(previous?.stage, stage)
      : stage;
    setPipelineItems((current) => {
      const exists = current.some((item) => item.id === jobId);
      if (exists) return current.map((item) => item.id === jobId ? { ...item, stage: optimisticStage } : item);
      return [...current, { id: jobId, stage: optimisticStage } as PipelineJob];
    });

    const request = (async () => {
      try {
        const response = await fetch("/api/pipeline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId, stage, mode }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error ?? "Não foi possível atualizar o acompanhamento.");
        const persistedStage = data?.stage ?? optimisticStage;
        setPipelineItems((current) => current.map((item) => item.id === jobId ? { ...item, stage: persistedStage } : item));
        if (toast) setMessage(toast);
        return true;
      } catch (error) {
        setPipelineItems((current) => {
          const currentItem = current.find((item) => item.id === jobId);
          if (currentItem?.stage !== optimisticStage) return current;
          if (previous) return current.map((item) => item.id === jobId ? previous : item);
          return current.filter((item) => item.id !== jobId);
        });
        setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o acompanhamento.");
        return false;
      }
    })().finally(() => pipelineUpdateRequestsRef.current.delete(requestKey));
    pipelineUpdateRequestsRef.current.set(requestKey, request);
    return request;
  }
  async function persistJobAnalysis(job: Job) {
    if (job.id.startsWith("demo") || !currentUser || !selectedJobVerdict || !selectedJobEligible) return;
    setAnalysisSaving(true);
    try {
      const [response, stageSaved] = await Promise.all([
        fetch(`/api/jobs/${encodeURIComponent(job.id)}/analysis`, { method: "POST" }),
        updateStage(job.id, AUTOMATIC_ACTION_STAGE.analyze, undefined, "advance"),
      ]);
      if (response.ok && stageSaved) setMessage("Análise registrada e vaga salva automaticamente.");
      else {
        const data = await response.json().catch(() => null);
        setMessage(data?.error ?? "A análise foi exibida, mas não pôde ser registrada agora.");
      }
    } catch {
      setMessage("A análise foi exibida, mas não pôde ser registrada agora.");
    } finally {
      setAnalysisSaving(false);
    }
  }
  function updateApplicationStatus(job: Job, status: ApplicationStatus, stage: "saved" | "applied", toast?: string) {
    const requestKey = `${job.id}:${status}:${stage}`;
    const pending = applicationUpdateRequestsRef.current.get(requestKey);
    if (pending) return pending;

    const previous = pipelineItems.find((item) => item.id === job.id);
    const optimisticStage = resolveAutomaticStage(previous?.stage, stage);
    const statusRank: Record<ApplicationStatus, number> = { generated: 0, sent: 1, responded: 2 };
    const optimisticStatus = previous?.applicationStatus && statusRank[previous.applicationStatus] > statusRank[status]
      ? previous.applicationStatus
      : status;
    const now = new Date().toISOString();
    const optimisticApplication: Partial<PipelineJob> = {
      stage: optimisticStage,
      applicationStatus: optimisticStatus,
      generatedAt: previous?.generatedAt ?? now,
      sentAt: optimisticStatus === "sent" || optimisticStatus === "responded" ? previous?.sentAt ?? now : previous?.sentAt,
      respondedAt: optimisticStatus === "responded" ? previous?.respondedAt ?? now : previous?.respondedAt,
    };
    setPipelineItems(current => {
      const exists = current.some(item => item.id === job.id);
      if (exists) return current.map(item => item.id === job.id ? { ...item, ...optimisticApplication } : item);
      return [...current, { ...job, ...optimisticApplication } as PipelineJob];
    });

    const request = (async () => {
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/application`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, stage }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error ?? "Não foi possível atualizar o status da candidatura.");
        const application = data.application as PipelineJob;
        setPipelineItems(current => current.map(item => item.id === job.id ? { ...item, ...application } : item));
        const labels: Record<ApplicationStatus, string> = { generated: "Mensagem registrada como gerada.", sent: "Candidatura marcada como enviada.", responded: "Resposta recebida registrada." };
        setMessage(toast ?? labels[status]);
        return true;
      } catch (error) {
        setPipelineItems(current => {
          const currentItem = current.find(item => item.id === job.id);
          if (currentItem?.stage !== optimisticStage || currentItem.applicationStatus !== optimisticStatus) return current;
          if (previous) return current.map(item => item.id === job.id ? previous : item);
          return current.filter(item => item.id !== job.id);
        });
        setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o status da candidatura.");
        return false;
      }
    })().finally(() => applicationUpdateRequestsRef.current.delete(requestKey));
    applicationUpdateRequestsRef.current.set(requestKey, request);
    return request;
  }
  async function deepenWithAi(job: Job) {
    if (job.id.startsWith("demo")) return setMessage("A análise com IA está disponível para vagas reais.");
    setIntelligenceLoading(true);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/intelligence`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) return setMessage(data?.error ?? "Não foi possível aprofundar esta vaga com IA.");
      setJobIntelligence(current => ({ ...current, [job.id]: data as JobIntelligence }));
      const statusResponse = await fetch("/api/ai/status", { cache: "no-store" });
      if (statusResponse.ok) setAiStatus(await statusResponse.json());
      setMessage(data.cached ? "Análise aprofundada recuperada do cache, sem gastar novos tokens." : "Análise aprofundada concluída e contabilizada.");
    } catch {
      setMessage("A IA está indisponível agora; a análise pelas regras permanece válida.");
    } finally {
      setIntelligenceLoading(false);
    }
  }
  async function save(job: Job) {
    if (job.id.startsWith("demo")) {
      setMessage("Entre na versão publicada para salvar vagas reais.");
      return;
    }
    await updateStage(job.id, "saved", "Vaga salva no seu pipeline.");
  }
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.assign("/");
  }
  async function openPipeline() {
    setPipelineOpen(true);
    setPipelineLoading(true);
    setMessage("");
    const r = await fetch("/api/pipeline");
    if (r.ok) {
      const d = await r.json();
      setPipelineItems(d.items ?? []);
    } else setMessage("Entre com sua conta para acessar seu pipeline.");
    setPipelineLoading(false);
  }
  async function updatePipeline(jobId: string, stage: string, note: string) {
    const previous = pipelineItems.find((item) => item.id === jobId);
    setPipelineItems((current) => current.map((item) => item.id === jobId ? { ...item, stage, note } : item));
    try {
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId, stage, note, mode: "replace" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? "Não foi possível atualizar o pipeline.");
      setPipelineItems((current) => current.map((item) => item.id === jobId ? { ...item, stage: data?.stage ?? stage, note } : item));
      setMessage("Pipeline atualizado.");
    } catch (error) {
      if (previous) setPipelineItems((current) => current.map((item) => item.id === jobId ? previous : item));
      setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o pipeline.");
    }
  }
  async function removeFromPipeline(jobId: string) {
    const r = await fetch("/api/pipeline", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    if (r.ok) {
      setPipelineItems((current) =>
        current.filter((item) => item.id !== jobId),
      );
      setMessage("Vaga removida do pipeline.");
    } else setMessage("Não foi possível remover do pipeline.");
  }
  async function configureGmail() {
    const r = await fetch("/api/admin/gmail-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: gmailSecret }),
      }),
      data = await r.json();
    setMessage(
      r.ok
        ? "Chave exclusiva salva. Use a mesma chave no Google Apps Script."
        : (data.error ?? "Falha ao salvar a chave"),
    );
  }
  async function loadJobDetail(job: Job) {
    setDescriptionCopied(false);
    setJobDetail(null);
    if (job.id.startsWith("demo")) {
      setDetailLoading(false);
      setJobDetail({
        description:
          job.description ||
          "Descrição completa disponível nas oportunidades importadas.",
        descriptionSource: "preview",
      });
      return;
    }
    setDetailLoading(true);
    try {
      const r = await fetch("/api/jobs/detail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jobId: job.id }),
        }),
        data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setJobDetail(data);
      if (Array.isArray(data.stack) && data.stack.length) {
        setItems((current) => {
          const next = current.map((item) => item.id === job.id ? {
            ...item,
            stack: data.stack,
            score: typeof data.score === "number" ? data.score : item.score,
            reasons: Array.isArray(data.reasons) ? data.reasons : item.reasons,
            scored: typeof data.scored === "boolean" ? data.scored : item.scored,
          } : item);
          loadedJobsRef.current = next;
          return next;
        });
      }
    } catch {
      setJobDetail({
        description:
          job.description ||
          "A descrição completa ainda não está disponível para esta vaga.",
        descriptionSource: "unavailable",
      });
    } finally {
      setDetailLoading(false);
    }
  }
  function buildShareLinks(job: Job) {
    const title = job.title;
    const company = job.company;
    const url = job.url ?? "";
    const text = company ? `${title} — ${company}` : title;
    const withUrl = url ? `${text}\n${url}` : text;
    const emailSubject = encodeURIComponent(`Vaga: ${text}`);
    const emailBody = encodeURIComponent(`Olá! Encontrei esta vaga que pode te interessar:\n\n${withUrl}`);
    const waText = encodeURIComponent(`Olá! Encontrei esta vaga que pode te interessar: ${withUrl}`);
    return {
      email: `mailto:?subject=${emailSubject}&body=${emailBody}`,
      whatsapp: `https://wa.me/?text=${waText}`,
    };
  }
  /**
   * Monta o mailto: de contato com a vaga (usado no bloco "Contato:" do
   * cabeçalho e no botão "Capturar e-mail"). Diferente de buildShareLinks
   * (que encaminha a vaga para outra pessoa), este é endereçado à própria
   * empresa — por isso já inclui um corpo padrão citando as skills que
   * bateram com o perfil (o mesmo dado do painel "Analisar candidatura") e,
   * quando disponível, a senioridade e outras skills dominadas do perfil
   * salvo. Nunca é enviado sozinho: só abre o cliente de e-mail da pessoa
   * para ela revisar e completar antes de mandar.
   *
   * Deliberadamente NÃO usa o score nem as skills que faltam (❌ do painel
   * de análise) — isso é um diagnóstico para a própria pessoa decidir se
   * vale se candidatar, não algo a se contar para a empresa.
   */
  function buildContactMailto(job: Job) {
    if (!job.contactEmail) return null;
    const stackFit = analyzeStackFit(job.stack, profileMasteredSkills);
    const body = buildApinfoApplicationEmail({
      title: job.title,
      company: job.company,
      externalId: isApinfoJob(job) ? job.externalId : undefined,
      matchingSkills: stackFit.matchingSkills,
      missingSkills: stackFit.missingSkills,
      seniority: profileChoices.seniority,
      careerRules: profileChoices.careerRules,
      contractSpecified: /\b(PJ|CLT|pessoa jurídica|carteira assinada)\b/i.test(job.description ?? ""),
    });
    const query = [
      `subject=${encodeURIComponent(job.contactSubject || `Candidatura — ${job.title}`)}`,
      `body=${encodeURIComponent(body)}`,
    ].filter(Boolean).join("&");
    return `mailto:${job.contactEmail}?${query}`;
  }
  async function saveApinfoContact(jobId: string, contactEmail: string, contactSubject?: string) {
    const r = await fetch(`/api/jobs/${jobId}/contact`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contactEmail, contactSubject }),
    });
    const data = await r.json().catch(() => null) as { contactEmail?: string; contactSubject?: string } | null;
    if (!r.ok) {
      // Outra captura/importação pode ter preenchido o contato enquanto
      // esta requisição estava em andamento. Nesse caso, mantém o valor já
      // persistido disponível na tela em vez de apresentar um falso erro.
      const persistedEmail = normalizeContactEmail(data?.contactEmail);
      if (r.status === 409 && persistedEmail) {
        setItems((current) =>
          current.map((item) =>
            item.id === jobId ? { ...item, contactEmail: persistedEmail } : item,
          ),
        );
        setContactPasteReady(false);
        setContactCaptureMsg({ text: `E-mail já cadastrado: ${persistedEmail}`, error: false });
        return true;
      }
      setContactCaptureMsg({ text: "E-mail encontrado, mas não foi possível salvar no Radar. Tente de novo.", error: true });
      return false;
    }
    const savedEmail = normalizeContactEmail(data?.contactEmail) ?? contactEmail;
    const savedSubject = data?.contactSubject ?? contactSubject;
    setItems((current) =>
      current.map((item) =>
        item.id === jobId ? { ...item, contactEmail: savedEmail, contactSubject: savedSubject } : item,
      ),
    );
    setContactPasteReady(false);
    setContactCaptureMsg({ text: `E-mail capturado: ${savedEmail}`, error: false });
    return true;
  }
  async function pasteApinfoContact(job: Job) {
    setContactCapturing(true);
    try {
      const clipboardText = await navigator.clipboard.readText();
      const contactEmail = clipboardText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
      if (!contactEmail) {
        setContactCaptureMsg({
          text: "Nenhum e-mail foi encontrado. Copie o endereço exibido na página do APinfo e tente novamente.",
          error: true,
        });
        return;
      }
      const contactSubject = job.externalId
        ? `apinfo - ${job.externalId} - ${job.title}`
        : `Candidatura — ${job.title}`;
      await saveApinfoContact(job.id, contactEmail, contactSubject);
    } catch {
      setContactCaptureMsg({
        text: "Não consegui ler a área de transferência. Copie o e-mail novamente e permita o acesso quando o navegador solicitar.",
        error: true,
      });
    } finally {
      setContactCapturing(false);
    }
  }
  /**
   * Pede à extensão do APinfo (via radar-bridge.js, content script rodando
   * nesta mesma página) para ler o contato já visível numa aba do APinfo
   * aberta em outra aba — normalmente a que o botão Candidatar acabou de
   * abrir, depois de a pessoa logar manualmente lá. O Radar não tem acesso
   * a outras abas do navegador sozinho; só a extensão consegue.
   */
  function captureApinfoContact(job: Job) {
    if (job.contactEmail) {
      setContactCaptureMsg({ text: `Contato já cadastrado: ${job.contactEmail}`, error: false });
      return;
    }
    if (!job.externalId) {
      setContactCaptureMsg({ text: "Esta vaga não tem código do APinfo identificado.", error: true });
      return;
    }
    const requestId = crypto.randomUUID();
    contactRequestRef.current = { requestId, jobId: job.id };
    setContactCapturing(true);
    setContactPasteReady(false);
    setContactCaptureMsg({ text: "Lendo a aba do APinfo…", error: false });
    if (contactRequestTimerRef.current) clearTimeout(contactRequestTimerRef.current);
    contactRequestTimerRef.current = setTimeout(() => {
      if (contactRequestRef.current?.requestId !== requestId) return;
      contactRequestRef.current = null;
      contactRequestTimerRef.current = null;
      setContactCapturing(false);
      setContactPasteReady(true);
      setContactCaptureMsg({
        text: "A extensão não respondeu. Copie o e-mail exibido no APinfo e clique em “Colar e-mail”.",
        error: true,
      });
    // A aba do APinfo é aberta em outra guia e pode levar alguns segundos
    // para terminar o redirecionamento/login. Não descarte uma resposta da
    // extensão cedo: ela pode ter lido o e-mail corretamente, mas chegar
    // depois do antigo limite de 4 segundos.
    }, APINFO_CONTACT_CAPTURE_TIMEOUT_MS);
    window.postMessage(
      { source: "radar-dashboard", type: "RADAR_CAPTURE_CONTACT", externalId: job.externalId, requestId },
      window.location.origin,
    );
  }
  // Escuta a resposta da extensão (repassada pelo radar-bridge.js). Registra
  // uma única vez (dependências vazias) e lê contactRequestRef.current no
  // momento da mensagem — não fecha sobre "selected"/"job", porque a pessoa
  // pode trocar de vaga selecionada enquanto a extensão ainda está lendo a
  // aba do APinfo, e o resultado precisa continuar valendo para a vaga
  // certa (a que foi pedida), não para a que estiver em foco quando chegar.
  useEffect(() => {
    function handleExtensionMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { source?: string; type?: string; requestId?: string; ok?: boolean; email?: string; assunto?: string; error?: string }
        | null;
      if (!data || data.source !== "radar-extension" || data.type !== "RADAR_CAPTURE_CONTACT_RESULT") return;
      const pending = contactRequestRef.current;
      if (!pending || data.requestId !== pending.requestId) return;

      contactRequestRef.current = null;
      if (contactRequestTimerRef.current) clearTimeout(contactRequestTimerRef.current);
      contactRequestTimerRef.current = null;
      setContactCapturing(false);

      if (!data.ok) {
        setContactPasteReady(true);
        setContactCaptureMsg({ text: data.error || "Não foi possível capturar o contato.", error: true });
        return;
      }

      if (data.email) {
        void saveApinfoContact(pending.jobId, data.email, data.assunto);
        return;
      }
      setContactPasteReady(true);
      setContactCaptureMsg({
        text: "Nenhum e-mail foi encontrado. Você pode tentar novamente ou colar o endereço manualmente.",
        error: true,
      });
    }
    window.addEventListener("message", handleExtensionMessage);
    return () => {
      window.removeEventListener("message", handleExtensionMessage);
      if (contactRequestTimerRef.current) clearTimeout(contactRequestTimerRef.current);
    };
  }, []);
  /**
   * Pede à extensão do APinfo (via radar-bridge.js) para capturar o contato
   * de VÁRIAS vagas em sequência — todas as vagas do APinfo hoje visíveis
   * na tela sem contactEmail. A extensão abre uma aba própria por vaga em
   * segundo plano, usando a sessão do APinfo já autenticada pela pessoa no
   * navegador (login manual, feito por ela mesma, como sempre foi); esta
   * função nunca solicita nem manipula credenciais.
   */
  function captureApinfoContactsBatch() {
    const pending = orderedJobs.filter((j) => isApinfoJob(j) && !j.contactEmail && j.applyUrl);
    if (!pending.length) {
      setContactCaptureMsg({ text: "Nenhuma vaga do APinfo sem e-mail está visível na tela agora.", error: true });
      return;
    }
    const requestId = crypto.randomUUID();
    contactBatchRequestIdRef.current = requestId;
    contactBatchJobsRef.current = new Map(pending.map((j) => [String(j.externalId), j]));
    contactBatchSaveFailedRef.current = 0;
    setContactBatchState({ requestId, total: pending.length, done: 0, found: 0, failed: 0 });
    setContactCaptureMsg(null);
    window.postMessage(
      {
        source: "radar-dashboard",
        type: "RADAR_CAPTURE_CONTACTS_BATCH",
        requestId,
        items: pending.map((j) => ({ externalId: j.externalId, applyUrl: j.applyUrl })),
      },
      window.location.origin,
    );
  }
  function cancelApinfoContactsBatch() {
    const requestId = contactBatchRequestIdRef.current;
    if (!requestId) return;
    window.postMessage(
      { source: "radar-dashboard", type: "RADAR_CAPTURE_CONTACTS_BATCH_CANCEL", requestId },
      window.location.origin,
    );
  }
  // Escuta progresso e resultado final da captura em lote (repassados pelo
  // radar-bridge.js). Cada vaga com e-mail encontrado é salva assim que o
  // progresso chega — não espera o lote inteiro terminar — reaproveitando
  // saveApinfoContact, a mesma função usada na captura individual. Registro
  // único (dependências vazias), como handleExtensionMessage acima — usa
  // itemsRef.current em vez de fechar sobre "items"/"orderedJobs", que
  // mudariam a cada e-mail salvo e forçariam remover/re-registrar o
  // listener no meio do lote.
  useEffect(() => {
    function handleBatchMessage(event: MessageEvent) {
      if (event.source !== window) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | {
            source?: string;
            type?: string;
            requestId?: string;
            ok?: boolean;
            error?: string;
            total?: number;
            index?: number;
            last?: { externalId?: string; ok?: boolean; email?: string; assunto?: string; error?: string };
            results?: Array<{ externalId?: string; ok?: boolean; email?: string; assunto?: string; error?: string }>;
            found?: number;
            failed?: number;
            stoppedReason?: string | null;
            cancelled?: boolean;
          }
        | null;
      if (!data || data.source !== "radar-extension") return;
      if (data.requestId !== contactBatchRequestIdRef.current) return;

      if (data.type === "RADAR_CAPTURE_CONTACTS_BATCH_PROGRESS") {
        const last = data.last;
        if (last?.ok && last.email && last.externalId) {
          // Lookup no snapshot fixo (contactBatchJobsRef), não em itemsRef —
          // ver comentário na declaração do ref. Sem isso, uma vaga que
          // saísse de "items" durante o lote (minutos de duração) perdia o
          // e-mail já capturado, sem erro visível.
          const job = contactBatchJobsRef.current.get(String(last.externalId));
          if (job) {
            saveApinfoContact(job.id, last.email, last.assunto)
              .then((saved) => {
                if (!saved) contactBatchSaveFailedRef.current += 1;
              })
              .catch(() => {
                contactBatchSaveFailedRef.current += 1;
              });
          }
        }
        setContactBatchState((current) =>
          current
            ? {
                ...current,
                done: data.index ?? current.done,
                found: current.found + (last?.ok && last.email ? 1 : 0),
                failed: current.failed + (last && !(last.ok && last.email) ? 1 : 0),
              }
            : current,
        );
        return;
      }

      if (data.type === "RADAR_CAPTURE_CONTACTS_BATCH_RESULT") {
        contactBatchRequestIdRef.current = null;
        if (!data.ok) {
          setContactCaptureMsg({ text: data.error || "Falha na captura em lote.", error: true });
          setContactBatchState(null);
          return;
        }
        // No cancelamento (radar-bridge.js), o background.js já parou de
        // postar assim que a porta desconectou — found/failed não vêm
        // dele. O que já foi encontrado até o cancelamento está em
        // contactBatchState (atualizado a cada PROGRESS, cada um já salvo
        // via saveApinfoContact) — usa o valor mais recente, não o 0 fixo
        // que a mensagem sintética de cancelamento carrega.
        setContactBatchState((current) => {
          const found = data.cancelled ? (current?.found ?? 0) : data.found ?? 0;
          const failed = data.cancelled ? (current?.failed ?? 0) : data.failed ?? 0;
          // saveFailed vem de um ref (não do state), porque o PATCH de
          // saveApinfoContact pode ainda estar em andamento neste exato
          // instante (ver declaração de contactBatchSaveFailedRef) — a
          // última vaga do lote em especial costuma ainda não ter resolvido.
          // Se isso acontecer, saveApinfoContact ainda assim atualiza
          // contactCaptureMsg sozinha (não fica mais suprimida, já que
          // contactBatchState volta a null aqui embaixo) — a mensagem final
          // pode ser corrigida por um flash logo em seguida nesse caso raro.
          const saveFailed = contactBatchSaveFailedRef.current;
          const saved = Math.max(0, found - saveFailed);
          const saveFailedNote = saveFailed
            ? ` ${saveFailed} encontrado${saveFailed === 1 ? "" : "s"} mas não salvo${saveFailed === 1 ? "" : "s"} no Radar — tente de novo para essa${saveFailed === 1 ? "" : "s"}.`
            : "";
          const label = data.cancelled
            ? `Captura em lote cancelada: ${saved} e-mail${saved === 1 ? "" : "s"} salvo${saved === 1 ? "" : "s"} até parar.${saveFailedNote}`
            : data.stoppedReason
              ? `${data.stoppedReason} (${saved} e-mail${saved === 1 ? "" : "s"} salvo${saved === 1 ? "" : "s"} até parar.)${saveFailedNote}`
              : `Captura em lote concluída: ${saved} e-mail${saved === 1 ? "" : "s"} salvo${saved === 1 ? "" : "s"}${failed ? `, ${failed} não encontrado${failed === 1 ? "" : "s"}` : ""}.${saveFailedNote}`;
          setContactCaptureMsg({ text: label, error: Boolean(saveFailed) });
          return null;
        });
      }
    }
    window.addEventListener("message", handleBatchMessage);
    return () => window.removeEventListener("message", handleBatchMessage);
  }, []);
  /**
   * Fluxo único de candidatura. Para vagas do APinfo, abre a página antes
   * de pedir a captura. Assim a extensão consulta a nova aba — já com o
   * contato renderizado — em vez de disputar a captura com a navegação.
   * Uma falha de captura nunca bloqueia a vaga.
   */
  function openJobApplication(job: Job) {
    if (job.applyUrl) {
      open(job.applyUrl, "_blank");
    } else if (isApinfoJob(job) && job.externalId) {
      openApinfoJobSearch(job.externalId);
    } else if (job.url) {
      open(job.url, "_blank");
    }
    if (isApinfoJob(job) && !job.contactEmail) {
      // Dá tempo para o APinfo concluir a troca de página antes de a
      // extensão procurar a aba mais recente e injetar o coletor.
      window.setTimeout(() => captureApinfoContact(job), 1_500);
    }
    void updateStage(
      job.id,
      AUTOMATIC_ACTION_STAGE.apply,
      "Página da vaga aberta e status salvo como Candidatura.",
      "advance",
    );
  }
  useEffect(() => {
    if (!shareMenuJobId) return;
    function handleOutsideClick(e: MouseEvent) {
      if (!(e.target as Element).closest(".share-wrap")) setShareMenuJobId(null);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [shareMenuJobId]);
  function openJobDetail(job: Job) {
    setDescriptionCopied(false);
    setDetailJob(job);
    void loadJobDetail(job);
  }
  async function copyDescription() {
    const description = jobDetail?.description || detailJob?.description || selected?.description;
    if (!description) return;
    await navigator.clipboard.writeText(description);
    setDescriptionCopied(true);
    setTimeout(() => setDescriptionCopied(false), 1800);
  }
  const pipelineStages = [
    { id: "viewed", label: "Visualizadas" },
    { id: "saved", label: "Salvas" },
    { id: "applied", label: "Candidaturas" },
    { id: "interview", label: "Entrevistas" },
    { id: "offer", label: "Ofertas" },
    { id: "rejected", label: "Encerradas" },
  ];
  const userName =
      currentUser?.fullName || currentUser?.displayName || "Visitante",
    initials = userName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  const isAdmin = currentUser?.role === "admin",
    isOwner = isOwnerEmail(currentUser?.email),
    canManageSources = isOwner,
    visibleNav = nav.filter((item) => {
      if (item === "Fontes" || item === "Importações") return canManageSources;
      if (item === "Auditoria" || item === "Triagem IA" || item === "Extensão LinkedIn" || item === "Extensão APinfo") return isOwner;
      return (
        (isAdmin && (item !== "Usuários" || isOwner)) ||
        !new Set(["Auditoria", "Triagem IA", "Usuários", "Extensão LinkedIn", "Extensão APinfo"]).has(item)
      );
    }),
    icons: Record<string, string> = {
      Radar: "⌁",
      Pipeline: "▦",
      Alertas: "●",
      Métricas: "▥",
      Monitoramento: "◌",
      Auditoria: "≡",
      "Triagem IA": "◈",
      Qualidade: "✓",
      Usuários: "♙",
      "Extensão LinkedIn": "in",
      "Extensão APinfo": "ap",
      "Gmail RadarVagas": "✉",
      Fontes: "◉",
      Importações: "↥",
      Configurações: "⚙",
    };
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            RADAR
            <br />
            <b>CARREIRA</b>
          </span>
        </div>
        <nav>
          {visibleNav.map((n) => (
            <button
              key={n}
              className={active === n ? "active" : ""}
              onClick={() => {
                setActive(n);
                if (n === "Pipeline") openPipeline();
                if (n === "Alertas") setAlertsOpen(true);
                if (n === "Métricas") setAnalyticsOpen(true);
                if (n === "Monitoramento") setMonitorOpen(true);
                if (n === "Auditoria") setAuditOpen(true);
                if (n === "Triagem IA") setTriageOpen(true);
                if (n === "Qualidade") setQualityOpen(true);
                if (n === "Usuários") setUsersOpen(true);
                if (n === "Extensão LinkedIn") setLinkedInOpen(true);
                if (n === "Extensão APinfo") setApinfoOpen(true);
                if (n === "Gmail RadarVagas") setGmailOpen(true);
                if (n === "Importações") setImporting(true);
                if (n === "Fontes") setSourcesOpen(true);
                if (n === "Configurações") openProfile();
              }}
            >
              <span>{icons[n]}</span>
              {n}
              {n === "Importações" && <em>ADMIN</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{initials || "V"}</div>
          <div>
            <strong>{userName}</strong>
            <small>
              {isAdmin
                ? "Administrador"
                : currentUser
                  ? "Usuário"
                  : "Não conectado"}
            </small>
          </div>
          {currentUser && (
            <button className="signout" onClick={signOut}>
              Sair
            </button>
          )}
        </div>
      </aside>
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">
              RADAR ·{" "}
              {effectivePeriod === "24"
                ? "ÚLTIMAS 24 HORAS"
                : effectivePeriod === "72"
                  ? "ÚLTIMOS 3 DIAS"
                  : effectivePeriod === "168"
                    ? "ÚLTIMOS 7 DIAS"
                    : "TODAS AS VAGAS"}
              {sourcesCount !== null && sourcesCount > 0
                ? ` · ${sourcesCount} FONTE${sourcesCount !== 1 ? "S" : ""} ATIVA${sourcesCount !== 1 ? "S" : ""}`
                : ""}{" "}
              · {mode === "database" ? "BANCO ATIVO" : "PRÉVIA LOCAL"}
            </p>
            <h1>
              {active === "Radar"
                ? `Oportunidades para você${currentUser ? `, ${userName.split(" ")[0]}` : ""}`
                : active}
            </h1>
          </div>
          <div className="header-actions">
            {!currentUser && (
              <a className="icon-btn" href="/login?return_to=/">
                Entrar
              </a>
            )}
            {canManageSources && <NotificationBell onOpenImportRun={setImportReportRunId} />}
            {currentUser && (
              <div className="report-menu-wrap">
                <button
                  type="button"
                  className="icon-btn report-trigger"
                  onClick={() => setReportOptionsOpen((open) => !open)}
                  disabled={reportLoading}
                  aria-expanded={reportOptionsOpen}
                  aria-haspopup="menu"
                  title="Exporta as vagas respeitando todos os filtros ativos"
                >
                  {reportLoading ? <><span className="button-spinner" aria-hidden="true" /> Exportando…</> : "↓ Exportar Excel"}
                </button>
                {reportOptionsOpen && (
                  <div className="report-dropdown" role="menu" aria-label="Opções de exportação">
                    <button type="button" role="menuitem" onClick={() => void downloadReport("page")}>
                      <span aria-hidden="true">📄</span>
                      <span><strong>Exportar página atual</strong><small>{orderedJobs.length > 0 ? `${orderedJobs.length} vaga${orderedJobs.length !== 1 ? "s" : ""}` : "Nenhuma vaga nesta página"}</small></span>
                    </button>
                    <button type="button" role="menuitem" onClick={() => void downloadReport("all")}>
                      <span aria-hidden="true">📊</span>
                      <span><strong>Exportar todas</strong><small>{(totalJobs ?? orderedJobs.length).toLocaleString("pt-BR")} vagas correspondentes</small></span>
                    </button>
                  </div>
                )}
              </div>
            )}
            {canManageSources && (
              <button className="primary" onClick={() => setImporting(true)}>
                ＋ Importar vagas
              </button>
            )}
          </div>
        </header>
        <div className="toast-region" aria-live="polite" aria-atomic="true">
          {message && (
            <div className="radar-toast" role="status">
              <span className="toast-mark" aria-hidden="true">✓</span>
              <span>{message}</span>
              <button type="button" onClick={() => setMessage("")} aria-label="Dispensar notificação">×</button>
            </div>
          )}
        </div>
        {profileLoading ? (
          <div className="notice" role="status">
            Carregando seu perfil e calculando a aderência das vagas…
          </div>
        ) : mode === "unavailable" ? (
          <div className="notice" role="alert">
            <span>{loadError ?? "Não foi possível carregar o Radar."}</span>{" "}
            <button type="button" onClick={retryRadarLoad}>Tentar novamente</button>
          </div>
        ) : personalizationUnavailable ? (
          <div className="notice" role="status">
            Seu perfil está salvo. A lista está temporariamente sem aderência enquanto a consulta é recuperada.
          </div>
        ) : null}
        <div className="radar-controls">
          <div className="radar-result-summary">
            <span aria-live="polite">
              <strong>{(totalJobs ?? orderedJobs.length).toLocaleString("pt-BR")}</strong> vagas encontradas
              <span className="list-head-dim"> · {orderedJobs.length} exibida{orderedJobs.length !== 1 ? "s" : ""}</span>
            </span>
          </div>
          <div className="toolbar">
            <div className="search">
              <span aria-hidden="true">⌕</span>
              <label className="sr-only" htmlFor="radar-search">Buscar vagas</label>
              <input
                id="radar-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar código, cargo, empresa ou tecnologia"
              />
            </div>
            <select
              className="radar-source-select"
              aria-label="Origem das vagas"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="all">Todas as fontes</option>
              {jobFilterOptions.sources.map(option => <option key={option.id} value={option.id}>{option.label} ({option.count})</option>)}
            </select>
            <select
              aria-label="Período das vagas"
              onChange={(e) => handlePeriodChange(e.target.value)}
              value={effectivePeriod ?? "24"}
            >
              <option value="24">Últimas 24h</option>
              <option value="72">Últimos 3 dias</option>
              <option value="168">Últimos 7 dias</option>
              <option value="all">Todas</option>
            </select>
            <button
              type="button"
              className={`filter-trigger${filtersOpen ? " active" : ""}`}
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-controls="radar-filter-panel"
            >
              Filtros{activeFilterCount > 0 && <span>{activeFilterCount}</span>}
            </button>
            <div className="view-mode-toggle" role="group" aria-label="Forma de exibição das vagas">
              <button
                type="button"
                className={viewMode === "cards" ? "active" : ""}
                aria-pressed={viewMode === "cards"}
                onClick={() => { setViewMode("cards"); setTableDrawerOpen(false); }}
              >
                ☰ Lista
              </button>
              <button
                type="button"
                className={viewMode === "table" ? "active" : ""}
                aria-pressed={viewMode === "table"}
                onClick={() => { setViewMode("table"); setTableDrawerOpen(false); }}
              >
                ▦ Tabela
              </button>
            </div>
            {(apinfoContactsPendingCount > 0 || contactBatchState) && (
              contactBatchState ? (
                <button
                  type="button"
                  className="filter-trigger active"
                  onClick={cancelApinfoContactsBatch}
                  title="Cancela a captura em lote — o que já foi encontrado até agora fica salvo."
                >
                  Capturando {contactBatchState.done}/{contactBatchState.total}
                  {contactBatchState.found > 0 && ` · ${contactBatchState.found} ✓`}
                  {" · Cancelar"}
                </button>
              ) : (
                <button
                  type="button"
                  className="filter-trigger"
                  onClick={captureApinfoContactsBatch}
                  title="Abre, uma a uma em segundo plano, as páginas de contato das vagas do APinfo visíveis sem e-mail — requer que você já esteja autenticado no APinfo neste navegador."
                >
                  ✉ Capturar e-mails ({apinfoContactsPendingCount})
                </button>
              )
            )}
          </div>
        </div>
        {!contactBatchState && contactCaptureMsg && (
          <p
            className="list-head-dim"
            role="status"
            style={{ color: contactCaptureMsg.error ? "#b04a1a" : "#2e6b3e", margin: "-6px 0 4px" }}
          >
            {contactCaptureMsg.text}
          </p>
        )}
        {activeFilterChips.length > 0 && (
          <div className="active-filter-row" aria-label="Filtros ativos">
            <span>Filtros ativos</span>
            <div className="active-filter-chips">
              {activeFilterChips.map((chip) => (
                <button key={chip.id} type="button" onClick={chip.remove} aria-label={`Remover filtro ${chip.label}`}>
                  {chip.label}<span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
            {activeFilterChips.length > 1 && <button type="button" className="clear-all-chips" onClick={clearRadarFilters}>Limpar todos</button>}
          </div>
        )}
        {!personalizationPending && (
          <div className="score-controls" aria-label="Controles de aderência">
            <div className="score-controls-copy">
              <span className="compact-filter-label">Aderência mínima</span>
              <strong style={{ color: fitFilterColor }}>
                {effectiveMinScore === 0 ? "Sem corte" : `${effectiveMinScore}%`}
              </strong>
              <span className="score-controls-result">
                {scoreFilterPending ? (
                  <b role="status">Atualizando pontuação…</b>
                ) : (
                  <>
                    <b>{filtered.length} {filtered.length === 1 ? "vaga" : "vagas"}</b>
                    {totalJobs != null && totalJobs > items.length && <small>de {totalJobs.toLocaleString("pt-BR")}</small>}
                  </>
                )}
              </span>
            </div>
            <div className="score-controls-range">
              <input
                type="range"
                className="fit-filter-slider score-controls-slider"
                aria-label="Escolher aderência mínima ao seu perfil"
                min={0}
                max={100}
                step={5}
                list="fit-filter-ticks"
                value={fitFilterSliderValue}
                onChange={(event) => handleFitFilterChange(Number(event.target.value))}
                style={{ "--fit-fill": `${fitFilterSliderValue}%`, "--fit-color": fitFilterColor } as CSSProperties}
              />
              <div className="score-controls-foot" aria-hidden="true">
                <span>0</span><span>100</span>
              </div>
            </div>
            <div className="score-controls-actions">
              <label className={`fit-filter-profile-chip${fitFilter === "profile" ? " active" : ""}`}>
                <input
                  type="checkbox"
                  checked={fitFilter === "profile"}
                  onChange={(event) => handleFitFilterChange(event.target.checked ? "profile" : 0)}
                />
                Usar meu perfil ({profileMinScore}%)
              </label>
              <label className="score-sort">
                <span>Ordenar por</span>
                <select value={sortOrder} onChange={(event) => handleSortOrderChange(event.target.value as "score" | "recent")} aria-label="Ordenar vagas">
                  <option value="score">Pontuação</option>
                  <option value="recent">Importadas recentemente</option>
                </select>
              </label>
              {typeof fitFilter === "number" && fitFilter < 80 && (
                <button type="button" className="fit-tip" onClick={() => handleFitFilterChange(80)}>
                  <span aria-hidden="true">💡</span> Dica: tente 80% ou mais para melhores resultados
                </button>
              )}
            </div>
            <datalist id="fit-filter-ticks">
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((tick) => <option key={tick} value={tick} />)}
            </datalist>
          </div>
        )}
        <div id="radar-filter-panel" className="radar-filter-panel" hidden={!filtersOpen} aria-label="Filtros de vagas">
          <div className="compact-filter-group">
            <span className="compact-filter-label">Área profissional</span>
            <div className="area-filter-grid" role="group" aria-label="Filtrar por área profissional">
              {jobFilterOptions.areas.filter(option => option.count > 0).map(option => (
                <button key={option.id} type="button" className={areaFilter === option.id ? "active" : ""} onClick={() => setAreaFilter(areaFilter === option.id ? "all" : option.id)} aria-pressed={areaFilter === option.id}>
                  {option.label}<span>{option.count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="compact-filter-divider" aria-hidden="true" />
          <div className="compact-filter-group ingestion-filter-group">
            <span className="compact-filter-label">Importação e recebimento</span>
            <div className="ingestion-filter-controls">
              <label>
                <span>Tipo de entrada</span>
                <select
                  value={ingestionMode}
                  onChange={(event) => setIngestionMode(event.target.value as typeof ingestionMode)}
                  aria-label="Filtrar pelo tipo de importação"
                >
                  <option value="all">Qualquer forma de entrada</option>
                  <option value="automatic">Somente automáticas</option>
                  <option value="manual">Somente manuais</option>
                </select>
              </label>
              <label>
                <span>Canal de entrada</span>
                <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} aria-label="Filtrar pelo canal de entrada">
                  <option value="all">Todos os canais</option>
                  {jobFilterOptions.channels.filter(option => option.count > 0).map(option => <option key={option.id} value={option.id}>{option.label} ({option.count})</option>)}
                </select>
              </label>
              <label>
                <span>Importação específica</span>
                <select value={importRunFilter} onChange={(event) => { setImportRunFilter(event.target.value); handlePeriodChange("all"); }} aria-label="Filtrar por uma importação específica">
                  <option value="all">Todas as importações</option>
                  {jobFilterOptions.importRuns.map(run => <option key={run.id} value={run.id}>{run.source} · {formatJobDateTime(run.startedAt)} · {run.jobs} vagas</option>)}
                </select>
              </label>
              <label>
                <span>Recebida a partir de</span>
                <input
                  type="datetime-local"
                  value={receivedFrom}
                  onChange={(event) => {
                    setReceivedFrom(event.target.value);
                    handlePeriodChange("all");
                  }}
                  aria-label="Data e hora inicial de recebimento"
                />
              </label>
              <label>
                <span>Recebida até</span>
                <input
                  type="datetime-local"
                  value={receivedTo}
                  onChange={(event) => {
                    setReceivedTo(event.target.value);
                    handlePeriodChange("all");
                  }}
                  min={receivedFrom || undefined}
                  aria-label="Data e hora final de recebimento"
                />
              </label>
            </div>
            <small className="list-head-dim">
              “Recebida” é a data e hora em que a vaga entrou no Radar. A publicação na fonte aparece separadamente em cada vaga.
            </small>
          </div>
          <div className="compact-filter-divider" aria-hidden="true" />
          <div className="compact-filter-group">
            <span className="compact-filter-label">Status</span>
            <div className="compact-pills" role="group" aria-label="Filtrar por estágio do pipeline">
              <select
                className="pipeline-filter-select"
                value={pipelineFilter}
                onChange={(event) => setPipelineFilter(event.target.value as typeof pipelineFilter)}
                aria-label="Filtrar por estágio do pipeline"
              >
              {([
                { id: "all", label: "Todas as vagas" },
                { id: "unseen", label: "Não vistas" },
                { id: "viewed", label: "Vistas" },
                { id: "saved", label: "Salvas" },
                { id: "applied", label: "Candidaturas" },
                { id: "interview", label: "Entrevistas" },
                { id: "rejected", label: "Encerradas" },
              ] as const).map(({ id, label }) => {
                const count = id === "all"
                  ? items.length
                  : id === "unseen"
                    ? items.filter((j) => !pipelineStageMap.has(j.id)).length
                    : items.filter((j) => pipelineStageMap.get(j.id) === id).length;
                return <option key={id} value={id}>{count > 0 ? `${label} (${count})` : label}</option>;
              })}
              </select>
            </div>
          </div>
          {personalizationPending ? (
            <div className="compact-filter-group" role="status">
              <span className="compact-filter-label">Personalização</span>
              <span className="list-head-dim">
                {profileLoading
                  ? "Aderência e veredito serão aplicados quando seu perfil terminar de carregar."
                  : "Seu perfil está salvo; a aderência será retomada assim que a consulta temporária for recuperada."}
              </span>
            </div>
          ) : currentUser && profileMasteredSkills.length > 0 && (
            <>
              <div className="compact-filter-divider" aria-hidden="true" />
              <div className="compact-filter-group">
                <span className="compact-filter-label">Veredito</span>
                <div className="compact-pills" role="group" aria-label="Filtrar por veredito">
                  {(["all", "✅", "🟡", "🔴", "❌"] as const).map((v) => {
                    const label = v === "all" ? "Todos" : v === "✅" ? "Bate" : v === "🟡" ? "Provável" : v === "🔴" ? "Não bate" : "Bloqueado";
                    const count = v === "all" ? items.length : [...verdictMap.values()].filter((r) => r.emoji === v).length;
                    return (
                      <button
                        key={v}
                        type="button"
                        className={verdictFilter === v ? "active" : ""}
                        onClick={() => handleVerdictFilterChange(v)}
                        aria-pressed={verdictFilter === v}
                      >
                        {v !== "all" && <>{v} </>}{label}{count > 0 && <span>{count}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
          {activeFilterCount > 0 && (
            <button type="button" className="clear-radar-filters" onClick={clearRadarFilters}>
              Limpar filtros
            </button>
          )}
        </div>
        {totalJobs != null && totalJobs > 50 && (
          <nav className="list-pagination" aria-label="Paginação de vagas">
            <button
              type="button"
              className="pagination-arrow"
              onClick={() => void goToJobsPage(currentPage - 1)}
              disabled={loadingMore || scoreFilterPending || currentPage <= 1}
              aria-label="Página anterior"
            >
              <span aria-hidden="true">←</span> <span className="pagination-button-label">Anterior</span>
            </button>
            {compactPagination(currentPage, Math.ceil(totalJobs / 50)).map((item) =>
              typeof item === "number" ? (
                <button
                  type="button"
                  key={item}
                  className={`pagination-page ${item === currentPage ? "active" : ""}`}
                  onClick={() => void goToJobsPage(item)}
                  disabled={loadingMore || scoreFilterPending}
                  aria-current={item === currentPage ? "page" : undefined}
                  data-page-distance={Math.abs(item - currentPage)}
                >
                  {item}
                </button>
              ) : (
                <span key={item} className="pagination-ellipsis" aria-hidden="true">…</span>
              ),
            )}
            <button
              type="button"
              className="pagination-arrow"
              onClick={() => void goToJobsPage(currentPage + 1)}
              disabled={loadingMore || scoreFilterPending || currentPage >= Math.ceil(totalJobs / 50)}
              aria-label="Próxima página"
            >
              <span className="pagination-button-label">Próxima</span> <span aria-hidden="true">→</span>
            </button>
            <span className="pagination-summary">Página {currentPage} de {Math.ceil(totalJobs / 50)}</span>
          </nav>
        )}
        <div className={`workspace${viewMode === "table" ? " workspace-table-mode" : ""}`}>
          <div className="job-list" ref={jobListRef} onScroll={handleJobListScroll}>
            {viewMode === "table" && orderedJobs.length > 0 && (
              <div className="job-table-wrap" role="table" aria-label="Vagas em formato de tabela">
                <div className="job-table-header" role="row">
                  {([
                    { column: "company" as const, label: "Empresa" },
                    { column: "title" as const, label: "Vaga" },
                    { column: "location" as const, label: "Local / Modalidade" },
                    { column: "score" as const, label: "Score / Veredito" },
                    { column: "stack" as const, label: "Stack" },
                    { column: "source" as const, label: "Fonte" },
                    { column: "publishedAt" as const, label: "Publicada" },
                  ]).map(({ column, label }) => (
                    <button
                      key={column}
                      type="button"
                      role="columnheader"
                      aria-sort={tableSort.column === column ? (tableSort.direction === "asc" ? "ascending" : "descending") : "none"}
                      className={`job-table-th${tableSort.column === column ? " active" : ""}`}
                      onClick={() => toggleTableSort(column)}
                    >
                      {label}
                      <span className="job-table-sort-arrow" aria-hidden="true">
                        {tableSort.column === column ? (tableSort.direction === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="job-table-filter-row" role="row">
                  <span role="cell" className="job-table-filter-cell">
                    <input type="text" placeholder="Filtrar empresa…" value={tableColumnFilters.company} onChange={(e) => setTableColumnFilter("company", e.target.value)} aria-label="Filtrar por empresa" />
                  </span>
                  <span role="cell" className="job-table-filter-cell">
                    <input type="text" placeholder="Filtrar vaga…" value={tableColumnFilters.title} onChange={(e) => setTableColumnFilter("title", e.target.value)} aria-label="Filtrar por título da vaga" />
                  </span>
                  <span role="cell" className="job-table-filter-cell">
                    <select value={tableColumnFilters.mode} onChange={(e) => setTableColumnFilter("mode", e.target.value)} aria-label="Filtrar por modalidade">
                      <option value="">Modalidade</option>
                      {tableModeOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </span>
                  <span role="cell" className="job-table-filter-cell">
                    <select value={tableColumnFilters.verdict} onChange={(e) => setTableColumnFilter("verdict", e.target.value)} aria-label="Filtrar por veredito">
                      <option value="">Veredito</option>
                      <option value="ok">✅ Recomendado</option>
                      <option value="maybe">🟡 Talvez</option>
                      <option value="no">🔴 Não recomendado</option>
                      <option value="blocked">⛔ Impedido</option>
                      <option value="none">— Sem veredito</option>
                    </select>
                  </span>
                  <span role="cell" className="job-table-filter-cell">
                    <input type="text" placeholder="Filtrar stack…" value={tableColumnFilters.stack} onChange={(e) => setTableColumnFilter("stack", e.target.value)} aria-label="Filtrar por stack" />
                  </span>
                  <span role="cell" className="job-table-filter-cell">
                    <select value={tableColumnFilters.source} onChange={(e) => setTableColumnFilter("source", e.target.value)} aria-label="Filtrar por fonte">
                      <option value="">Fonte</option>
                      {tableSourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </span>
                  <span role="cell" className="job-table-filter-cell job-table-filter-clear-cell">
                    {activeTableColumnFilterCount > 0 && <button type="button" className="job-table-filter-clear" onClick={clearTableColumnFilters}>Limpar ({activeTableColumnFilterCount})</button>}
                  </span>
                </div>
                {tableJobs.map((j) => {
                  const v = verdictMap.get(j.id);
                  const stage = pipelineStageMap.get(j.id);
                  const verdictKey = v ? (v.emoji === "✅" ? "ok" : v.emoji === "🟡" ? "maybe" : v.emoji === "🔴" ? "no" : "blocked") : null;
                  return (
                    <div
                      key={j.id}
                      role="row"
                      tabIndex={0}
                      className={`job-table-row ${selectedJob?.id === j.id ? "selected" : ""}`}
                      onClick={() => selectJob(j)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectJob(j);
                        }
                      }}
                    >
                      <span role="cell" className="job-table-cell job-table-cell-company">
                        {stage && stage !== "viewed" && (
                          <span className="card-stage-badge" aria-hidden="true">
                            {{ saved: "🔖", applied: "📨", interview: "🗓", offer: "🎉", rejected: "✕", archived: "✕" }[stage] ?? ""}
                          </span>
                        )}
                        {j.company}
                      </span>
                      <span role="cell" className="job-table-cell job-table-cell-title">
                        {j.title}
                      </span>
                      <span role="cell" className="job-table-cell job-table-cell-location">
                        <span className="job-table-location-line">⌖ {j.location}</span>
                        <span className="job-table-mode-tag">{j.mode}</span>
                      </span>
                      <span role="cell" className="job-table-cell job-table-cell-score">
                        {currentUser ? (
                          j.scored ? (
                            <>
                              <strong>{j.score}</strong>
                              {v && <span className={`verdict-badge verdict-${verdictKey}`}>{v.emoji}</span>}
                            </>
                          ) : (
                            <span title={j.reasons[0] ?? "Sem dados suficientes para calcular a aderência"}>—</span>
                          )
                        ) : (
                          <span className="score-locked" title="Entre para ver a aderência ao seu perfil">🔒</span>
                        )}
                      </span>
                      <span role="cell" className="job-table-cell job-table-cell-stack">
                        {j.stack.length ? (
                          <>
                            {j.stack.slice(0, 3).map((t) => <span key={t} className="job-table-stack-tag">{t}</span>)}
                            {j.stack.length > 3 && <span className="stack-more">+{j.stack.length - 3}</span>}
                          </>
                        ) : (
                          <span className="stack-unavailable">Stack não informada</span>
                        )}
                      </span>
                      <span role="cell" className="job-table-cell job-table-cell-source">
                        {j.sourceName ?? "—"}
                      </span>
                      <span role="cell" className="job-table-cell job-table-cell-date">
                        {j.sourcePublishedAt ? formatJobDateTime(j.sourcePublishedAt) : j.age}
                      </span>
                    </div>
                  );
                })}
                {tableJobs.length === 0 && (
                  <div className="job-table-empty">
                    Nenhuma vaga corresponde aos filtros de coluna atuais. {" "}
                    <button type="button" onClick={clearTableColumnFilters}>Limpar filtros de coluna</button>
                  </div>
                )}
              </div>
            )}
            {viewMode === "cards" && orderedJobs.map((j) => (
              <div
                key={j.id}
                role="button"
                tabIndex={0}
                className={`job-card ${selectedJob?.id === j.id ? "selected" : ""} ${currentUser && j.scored ? "job-card-scored" : ""}`}
                onClick={() => selectJob(j)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectJob(j);
                  }
                }}
              >
                <div className="score">
                  {currentUser ? (
                    j.scored ? (
                      <>
                        <strong>{j.score}</strong>
                        <small>pontos</small>
                        <span className="score-bar" aria-label={`${j.score} pontos de aderência`}>
                          <span className="score-bar-fill" style={{ width: `${j.score}%`, background: j.score >= 80 ? "#2e6b3e" : j.score >= 60 ? "#7a6200" : "#b04a1a" }} />
                        </span>
                      </>
                    ) : (
                      <span title={j.reasons[0] ?? "Sem dados suficientes para calcular a aderência"}>
                        —
                        <small>sem score</small>
                      </span>
                    )
                  ) : (
                    <span
                      className="score-locked"
                      title="Entre para ver a aderência ao seu perfil"
                    >
                      🔒
                    </span>
                  )}
                  {profileMasteredSkills.length > 0 && (() => {
                    const v = verdictMap.get(j.id);
                    return v ? <span className={`verdict-badge verdict-${v.emoji === "✅" ? "ok" : v.emoji === "🟡" ? "maybe" : v.emoji === "🔴" ? "no" : "blocked"}`}>{v.emoji}</span> : null;
                  })()}
                  {(() => {
                    const stage = pipelineStageMap.get(j.id);
                    if (!stage || stage === "viewed") return null;
                    const icons: Record<string, string> = { saved: "🔖", applied: "📨", interview: "🗓", offer: "🎉", rejected: "✕", archived: "✕" };
                    return icons[stage] ? <span className="card-stage-badge">{icons[stage]}</span> : null;
                  })()}
                </div>
                <div className="job-main">
                  <small>{j.company.toUpperCase()}</small>
                  <h3>{j.title}</h3>
                  <p>
                    ⌖ {j.location} · {j.mode} · {j.age}
                  </p>
                  <p className="job-ingestion-meta">
                    Publicada {formatJobDateTime(j.sourcePublishedAt)} · Recebida {formatJobDateTime(j.firstSeenAt)}
                    {` · ${j.ingestionMode === "automatic" ? "Automática" : "Manual"}`}
                    {` · ${channelLabel(j.ingestionChannel)}`}
                    {j.sourceName ? ` · ${j.sourceName}` : ""}
                  </p>
                  <div
                    className="tags job-stack"
                    aria-label="Tecnologias da vaga"
                  >
                    <span className="job-area-tag">{jobAreaLabel(j.roleArea)}</span>
                    {j.stack.length ? (
                      <>
                        {j.stack.slice(0, 3).map((t) => <span key={t}>{t}</span>)}
                        {j.stack.length > 3 && <span className="stack-more">+{j.stack.length - 3}</span>}
                      </>
                    ) : (
                      <span className="stack-unavailable">
                        Stack não informada
                      </span>
                    )}
                  </div>
                </div>
                <div className="share-wrap" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="share-btn"
                    title="Encaminhar vaga"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShareMenuJobId(shareMenuJobId === j.id ? null : j.id);
                    }}
                  >
                    📤
                  </button>
                  {shareMenuJobId === j.id && (() => {
                    const links = buildShareLinks(j);
                    return (
                      <div className="share-menu">
                        <button className="share-menu-item" onClick={() => {
                          window.open(links.email, "_blank");
                          void updateStage(j.id, AUTOMATIC_ACTION_STAGE.forward, "Vaga encaminhada e salva no acompanhamento.", "advance");
                        }}>📧 E-mail</button>
                        <button className="share-menu-item" onClick={() => {
                          window.open(links.whatsapp, "_blank");
                          void updateStage(j.id, AUTOMATIC_ACTION_STAGE.forward, "Vaga encaminhada e salva no acompanhamento.", "advance");
                        }}>💬 WhatsApp</button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}
            {filtered.length === 0 && !personalizationPending && (
              <div className="radar-empty">
                {mode === "unavailable" ? (
                  <>
                    <strong>Não foi possível carregar as vagas agora.</strong>
                    <span>Seus dados continuam salvos. Tente novamente em alguns instantes.</span>
                    <button onClick={() => setJobsRefreshVersion((version) => version + 1)}>
                      Tentar novamente
                    </button>
                  </>
                ) : (
                  <>
                    <strong>Nenhuma vaga corresponde aos filtros atuais.</strong>
                    <span>
                      Reduza o score mínimo ou amplie o período para visualizar as
                      oportunidades disponíveis.
                    </span>
                    <button onClick={clearRadarFilters}>
                      Mostrar todas as vagas
                    </button>
                    {isAdmin && (
                      <button
                        className="radar-empty-import"
                        onClick={() => setLinkedInOpen(true)}
                      >
                        Importar vagas do LinkedIn
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {viewMode === "table" && tableDrawerOpen && selectedJob && (
            <div className="detail-drawer-backdrop" onClick={() => setTableDrawerOpen(false)} aria-hidden="true" />
          )}
          {selectedJob && (viewMode !== "table" || tableDrawerOpen) ? (
            <aside className={`detail${analysisOpen ? " detail-analysis-open" : ""}${viewMode === "table" ? " detail-drawer" : ""}`}>
              <div className="detail-heading">
                {viewMode === "table" && (
                  <button type="button" className="detail-drawer-close" onClick={() => setTableDrawerOpen(false)} aria-label="Fechar detalhes da vaga">×</button>
                )}
                <div>
                  <small>{selectedJob.company.toUpperCase()}</small>
                  <h2>{selectedJob.title}</h2>
                  <p>
                    ⌖ {selectedJob.location} · {selectedJob.mode} ·{" "}
                    {selectedJob.age}
                  </p>
                  <p className="job-ingestion-meta job-detail-ingestion-meta">
                    Publicada na fonte: {formatJobDateTime(selectedJob.sourcePublishedAt)} · Recebida pelo Radar: {formatJobDateTime(selectedJob.firstSeenAt)}
                    {` · ${selectedJob.ingestionMode === "automatic" ? "Automática" : "Manual"}`}
                    {` · ${channelLabel(selectedJob.ingestionChannel)}`}
                    {selectedJob.sourceName ? ` · ${selectedJob.sourceName}` : ""}
                  </p>
                  {(selectedJob.externalId || selectedJob.url) && (
                    <p className="list-head-dim job-detail-source">
                      {selectedJob.externalId && (
                        <>Código: <code>{selectedJob.externalId}</code></>
                      )}
                      {selectedJob.externalId && selectedJob.url && " · "}
                      {selectedJob.url && (
                        <a
                          href={selectedJob.url}
                          target="_blank"
                          rel="noreferrer"
                          title={selectedJob.url}
                          onClick={(event) => {
                            // No APinfo, esse href é só uma referência (o
                            // formulário do site é POST, não GET) — clicar
                            // aqui direto abriria a busca vazia. Substitui
                            // pelo POST real quando temos o código da vaga.
                            if (isApinfoJob(selectedJob) && selectedJob.externalId) {
                              event.preventDefault();
                              openApinfoJobSearch(selectedJob.externalId);
                            }
                          }}
                        >
                          {selectedJob.url.length > 55
                            ? `${selectedJob.url.slice(0, 52)}…`
                            : selectedJob.url}
                        </a>
                      )}
                    </p>
                  )}
                  {selectedJob.applyUrl && selectedJob.applyUrl !== selectedJob.url && (
                    <p className="list-head-dim job-detail-source" title="Link direto usado pelo botão Candidatar — pode expirar">
                      Candidatura:{" "}
                      <a href={selectedJob.applyUrl} target="_blank" rel="noreferrer">
                        {selectedJob.applyUrl.length > 55
                          ? `${selectedJob.applyUrl.slice(0, 52)}…`
                          : selectedJob.applyUrl}
                      </a>
                    </p>
                  )}
                  {selectedJob.contactEmail && (
                    <p
                      className="list-head-dim job-detail-source job-detail-email"
                      data-testid="job-contact-email"
                      title="E-mail disponível para esta vaga — abre uma mensagem pronta para revisar antes de enviar"
                    >
                      <strong>E-mail:</strong>{" "}
                      <a href={buildContactMailto(selectedJob) ?? `mailto:${selectedJob.contactEmail}`}>
                        {selectedJob.contactEmail}
                      </a>
                    </p>
                  )}
                </div>
                <span className="fit-inline">
                  {currentUser ? (
                    selectedJob.scored ? (
                      <>
                        <strong>{selectedJob.score}%</strong>
                        <small>match</small>
                        <div className="fit-inline-bar">
                          <div
                            className="fit-inline-bar-fill"
                            style={{
                              width: `${selectedJob.score}%`,
                              background: selectedJob.score >= 80 ? "#2e6b3e" : selectedJob.score >= 60 ? "#7a6200" : "#b04a1a",
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <strong title={selectedJob.reasons[0]}>—</strong>
                        <small>sem score</small>
                      </>
                    )
                  ) : (
                    <span
                      className="fit-inline-locked"
                      title="Entre para ver a aderência ao seu perfil"
                    >
                      🔒
                    </span>
                  )}
                </span>
              </div>
              <div className="match-reasons">
                <h4>COMO O SCORE FOI CALCULADO</h4>
                {selectedJob.reasons.map((reason) => (
                  <span key={reason}>{reason}</span>
                ))}
              </div>
              <div className="detail-actions radar-job-actions">
                {/* Seletor de estágio do pipeline */}
                {(() => {
                  const currentStage = pipelineStageMap.get(selectedJob.id) ?? "unseen";
                  const stageLabels: Record<string, string> = {
                    unseen: "♡ Salvar",
                    viewed: "👁 Visualizada",
                    saved: "🔖 Salva",
                    applied: "📨 Candidatura",
                    interview: "🗓 Entrevista",
                    offer: "🎉 Oferta",
                    rejected: "✕ Encerrada",
                    archived: "✕ Encerrada",
                  };
                  return (
                    <div className="stage-selector-wrap">
                      <select
                        className="stage-selector"
                        value={currentStage === "unseen" ? "" : currentStage}
                        aria-label="Estágio no pipeline"
                        title="Salvar ou atualizar esta vaga no acompanhamento"
                        onChange={async (e) => {
                          const stage = e.target.value;
                          if (!stage) return;
                          if (selectedJob.id.startsWith("demo")) {
                            setMessage("Entre na versão publicada para salvar vagas reais.");
                            return;
                          }
                          await updateStage(selectedJob.id, stage, `Estágio atualizado: ${stageLabels[stage] ?? stage}`);
                        }}
                      >
                        {currentStage === "unseen" && <option value="" disabled>{stageLabels.unseen}</option>}
                        <option value="viewed">👁 Visualizada</option>
                        <option value="saved">🔖 Salvar</option>
                        <option value="applied">📨 Candidatura</option>
                        <option value="interview">🗓 Entrevista</option>
                        <option value="offer">🎉 Oferta</option>
                        <option value="rejected">✕ Encerrar</option>
                      </select>
                    </div>
                  );
                })()}
                <button
                  className={`analysis-toggle-btn${analysisOpen ? " active" : ""}`}
                  disabled={analysisSaving}
                  onClick={() => {
                    const opening = !analysisOpen;
                    setAnalysisOpen(opening);
                    if (opening && selectedJobEligible) void persistJobAnalysis(selectedJob);
                    // Fechar o painel de análise marca a triagem desta vaga como concluída.
                    else if (!opening) advanceToNextJob();
                  }}
                  title="Análise de candidatura com base no seu perfil"
                >
                  {analysisSaving ? "Registrando análise…" : analysisOpen ? "✕ Fechar análise" : "🔍 Analisar candidatura"}
                </button>
                <button
                  type="button"
                  className="primary-job-action"
                  title={selectedJobRejected ? `${selectedJobVerdict?.emoji} ${selectedJobVerdict?.label}: abrir mesmo assim` : "Abrir candidatura"}
                  onClick={() => {
                    openJobApplication(selectedJob);
                    advanceToNextJob();
                  }}
                >
                  Candidatar
                </button>
                {isApinfoJob(selectedJob) && (
                  <button
                    type="button"
                    className="analysis-toggle-btn"
                    disabled={contactCapturing}
                    title={
                      selectedJob.contactEmail
                        ? `Copiar ${selectedJob.contactEmail}`
                        : contactPasteReady
                          ? "Tentar novamente a captura automática na aba do APinfo"
                        : "Clique em Candidatar, faça login no APinfo até ver Empresa/Email na tela, e clique aqui"
                    }
                    onClick={() => {
                      if (selectedJob.contactEmail) {
                        void updateApplicationStatus(
                          selectedJob,
                          "generated",
                          AUTOMATIC_ACTION_STAGE.copy_email,
                          "E-mail copiado e vaga salva no acompanhamento.",
                        );
                        void navigator.clipboard.writeText(selectedJob.contactEmail).then(
                          () => undefined,
                          () => setMessage(`E-mail cadastrado: ${selectedJob.contactEmail}. Não foi possível copiá-lo automaticamente.`),
                        );
                        return;
                      }
                      captureApinfoContact(selectedJob);
                    }}
                  >
                    {selectedJob.contactEmail
                      ? "Copiar e-mail"
                      : contactCapturing
                        ? "Capturando…"
                        : contactPasteReady
                          ? "Tentar captura novamente"
                          : "Capturar e-mail"}
                  </button>
                )}
                {isApinfoJob(selectedJob) && !selectedJob.contactEmail && contactPasteReady && (
                  <button
                    type="button"
                    className="analysis-toggle-btn"
                    disabled={contactCapturing}
                    title="Colar o e-mail copiado da página do APinfo"
                    onClick={() => void pasteApinfoContact(selectedJob)}
                  >
                    Colar e-mail
                  </button>
                )}
                {selectedJob.contactEmail && (
                  <button
                    type="button"
                    className="primary-job-action"
                    title={`Abre seu cliente de e-mail com mensagem pronta para ${selectedJob.contactEmail}`}
                    onClick={() => {
                      const mailto = buildContactMailto(selectedJob);
                      if (mailto) {
                        // O cliente de e-mail precisa ser acionado durante o
                        // clique. Se aguardarmos a gravação no servidor, o
                        // navegador pode interpretar a abertura como popup.
                        window.location.href = mailto;
                        void updateApplicationStatus(
                          selectedJob,
                          "generated",
                          AUTOMATIC_ACTION_STAGE.open_outlook,
                          "Outlook aberto e status salvo como Candidatura.",
                        );
                      }
                    }}
                  >
                    ✉ Abrir no Outlook
                  </button>
                )}
                {selectedApplication?.applicationStatus && (
                  <div className="application-tracking" aria-label="Acompanhamento da candidatura">
                    <span>
                      {selectedApplication.applicationStatus === "generated" ? "Mensagem gerada" : selectedApplication.applicationStatus === "sent" ? "Candidatura enviada" : "Resposta recebida"}
                      {selectedApplication.generatedAt && <small>Gerada em {formatJobDate(selectedApplication.generatedAt)}</small>}
                      {selectedApplication.sentAt && <small>Enviada em {formatJobDate(selectedApplication.sentAt)}</small>}
                      {selectedApplication.respondedAt && <small>Resposta em {formatJobDate(selectedApplication.respondedAt)}</small>}
                    </span>
                    {selectedApplication.applicationStatus === "generated" && <button type="button" onClick={() => updateApplicationStatus(selectedJob, "sent", AUTOMATIC_ACTION_STAGE.mark_sent)}>Marcar como enviada</button>}
                    {selectedApplication.applicationStatus === "sent" && <button type="button" onClick={() => updateApplicationStatus(selectedJob, "responded", AUTOMATIC_ACTION_STAGE.mark_sent)}>Registrar resposta</button>}
                  </div>
                )}
                {(() => {
                  const links = buildShareLinks(selectedJob);
                  return (
                    <>
                      <button className="analysis-toggle-btn" onClick={() => {
                        window.open(links.email, "_blank");
                        void updateStage(selectedJob.id, AUTOMATIC_ACTION_STAGE.forward, "Vaga encaminhada e salva no acompanhamento.", "advance");
                        advanceToNextJob();
                      }}>
                        Encaminhar por e-mail
                      </button>
                      <button className="analysis-toggle-btn" onClick={() => {
                        window.open(links.whatsapp, "_blank");
                        void updateStage(selectedJob.id, AUTOMATIC_ACTION_STAGE.forward, "Vaga encaminhada e salva no acompanhamento.", "advance");
                        advanceToNextJob();
                      }}>
                        Encaminhar no WhatsApp
                      </button>
                      <button
                        className="analysis-toggle-btn"
                        onClick={() => void copyDescription()}
                        disabled={detailLoading || !(jobDetail?.description || selectedJob.description)}
                      >
                        {descriptionCopied ? "Descrição copiada" : "Copiar descrição"}
                      </button>
                      <button
                        className="analysis-toggle-btn"
                        title="Abrir descrição em tela ampliada"
                        onClick={() => openJobDetail(selectedJob)}
                      >
                        Ampliar descrição
                      </button>
                    </>
                  );
                })()}
              </div>
              {contactCaptureMsg && (
                <p
                  className="list-head-dim"
                  style={{ color: contactCaptureMsg.error ? "#b04a1a" : "#2e6b3e", margin: "-4px 0 10px" }}
                >
                  {contactCaptureMsg.text}
                </p>
              )}
              {profileMasteredSkills.length > 0 && (() => {
                const missingImprove = selectedJob.stack
                  .filter((skill) => !profileMasteredSkills.some((s) => s.toLowerCase() === skill.toLowerCase()))
                  .slice(0, 2);
                return missingImprove.length > 0 ? (
                  <div className="match-improve">
                    <h4>COMO MELHORAR</h4>
                    {missingImprove.map((skill) => (
                      <span key={skill}>＋ Adicionar <strong>{skill}</strong> ao perfil pode aumentar o score nesta vaga</span>
                    ))}
                  </div>
                ) : null;
              })()}
              <div className={`selected-description-columns${analysisOpen ? " analysis-open" : ""}`}>
                <section className="selected-description">
                  <div>
                    <h4>DESCRIÇÃO DA VAGA</h4>
                  </div>
                  {detailLoading ? (
                    <p className="detail-loading">Buscando a descrição completa…</p>
                  ) : (
                    <DescriptionContent
                      text={
                        jobDetail?.description ||
                        selectedJob.description ||
                        "A descrição completa ainda não está disponível para esta vaga."
                      }
                    />
                  )}
                </section>
                {analysisOpen && (() => {
                  // Usa a descrição enriquecida se disponível para maior precisão
                  const analysisStack = jobDetail?.stack?.length ? jobDetail.stack : selectedJob.stack;
                  const verdict = computeVerdict({
                    title: selectedJob.title,
                    description: jobDetail?.description || selectedJob.description || "",
                    stack: analysisStack,
                    seniority: selectedJob.seniority,
                    workMode: selectedJob.workMode,
                    location: selectedJob.location,
                  }, profileMasteredSkills, profileChoices.careerRules);
                  const verdictColor = verdict.emoji === "✅" ? "#2e6b3e" : verdict.emoji === "🟡" ? "#7a6200" : verdict.emoji === "🔴" ? "#b04a1a" : "#8a1a1a";
                  return (
                    <aside className="job-analysis-panel">
                      <div className="analysis-score-bar">
                        <span className="analysis-score-num">{selectedJob.scored ? `${selectedJob.score}%` : "—"}</span>
                        <div className="analysis-score-track">
                          <div className="analysis-score-fill" style={{ width: `${selectedJob.scored ? selectedJob.score : 0}%`, background: selectedJob.score >= 80 ? "#2e6b3e" : selectedJob.score >= 60 ? "#4a7a35" : "#b04a1a" }} />
                        </div>
                        <span className="analysis-score-label" style={{ color: verdictColor }}>
                          {selectedJob.scored ? <>
                            {verdict.emoji} {verdict.label}
                            {verdict.blocker && <><br /><span style={{ fontSize: "8px", fontWeight: 400 }}>{verdict.blocker}</span></>}
                          </> : selectedJob.reasons[0]}
                        </span>
                      </div>

                      {selectedJob.scored && <table className="verdict-table">
                        <tbody>
                          {verdict.rows.map((row) => (
                            <tr key={row.criterion} className={row.ok === false ? "verdict-row-bad" : row.ok === true ? "verdict-row-ok" : ""}>
                              <td className="verdict-criterion">{row.criterion}</td>
                              <td className="verdict-status">{row.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>}

                      {selectedJob.scored && (
                        <p className={`analysis-persistence-note ${selectedJobEligible ? "eligible" : "discarded"}`}>
                          {selectedJobEligible
                            ? "Esta oportunidade é elegível e foi adicionada ao histórico de análises."
                            : "Esta análise é apenas explicativa e não foi adicionada ao acompanhamento."}
                        </p>
                      )}

                      {selectedJob.scored && (
                        <div className="ai-deep-analysis">
                          <button
                            type="button"
                            className="analysis-toggle-btn"
                            disabled={intelligenceLoading || !aiStatus?.provider.configured}
                            onClick={() => void deepenWithAi(selectedJob)}
                            title={aiStatus?.provider.configured ? "Analisa ambiguidades, empresa, cultura e entrevista" : "Configure a IA no servidor para ativar"}
                          >
                            {intelligenceLoading ? "Aprofundando…" : jobIntelligence[selectedJob.id] ? "Atualizar análise com IA" : "✨ Aprofundar com IA"}
                          </button>
                          {aiStatus && <small className="list-head-dim">IA: {aiStatus.usage.remainingTokens.toLocaleString("pt-BR")} tokens disponíveis neste mês</small>}
                          {jobIntelligence[selectedJob.id] && (() => {
                            const intel = jobIntelligence[selectedJob.id];
                            return <div className="ai-intelligence-result">
                              <h4>EMPRESA E CONTEXTO</h4>
                              <p><strong>{intel.facts.companyType}</strong> · {intel.facts.businessDomain}</p>
                              <p><strong>Contrato:</strong> {intel.facts.contract} · <strong>Idioma:</strong> {intel.facts.languageRequirement}</p>
                              {intel.facts.cultureSignals.length > 0 && <p><strong>Sinais de cultura:</strong> {intel.facts.cultureSignals.join(" · ")}</p>}
                              {intel.facts.evidence.length > 0 && <details><summary>Evidências encontradas na vaga</summary><ul>{intel.facts.evidence.map((item, index) => <li key={`${item.finding}-${index}`}><strong>{item.finding}:</strong> “{item.excerpt}”</li>)}</ul></details>}
                              {intel.facts.ambiguities.length > 0 && <details><summary>Pontos para confirmar</summary><ul>{intel.facts.ambiguities.map(item => <li key={item}>{item}</li>)}</ul></details>}
                              <h4>PREPARAÇÃO PARA ENTREVISTA</h4>
                              <p>{intel.interview.anchor}</p><p>{intel.interview.gaps}</p>
                              <ul>{intel.interview.questions.map(item => <li key={item}>{item}</li>)}</ul>
                              <small>{intel.cached ? "Resultado reutilizado do cache" : `Gerado por ${intel.provider} · ${intel.model}`}</small>
                            </div>;
                          })()}
                        </div>
                      )}

                      {selectedJob.scored && (() => {
                        const stackFit = analyzeStackFit(analysisStack, profileMasteredSkills);
                        return (
                          <>
                            {stackFit.matchingSkills.length > 0 && (
                              <div className="analysis-skill-group">
                                <p className="analysis-label analysis-match">✅ {stackFit.matchingSkills.length} de {stackFit.requiredSkills.length} requisitos já estão no seu perfil</p>
                                <div className="tags">{stackFit.matchingSkills.map((s) => <span key={s} className="tag-match">{s}</span>)}</div>
                              </div>
                            )}
                            {stackFit.requiredSkills.length > 0 && stackFit.matchingSkills.length === 0 && (
                              <div className="analysis-skill-group analysis-zero-match">
                                <p className="analysis-label analysis-gap">0 de {stackFit.requiredSkills.length} requisitos técnicos identificados nesta vaga aparecem no seu perfil</p>
                                <span>Isso compara apenas o que a vaga declarou; não conclui que você não tenha experiência.</span>
                              </div>
                            )}
                            {stackFit.missingSkills.length > 0 && (
                              <div className="analysis-skill-group">
                                <p className="analysis-label analysis-gap">⚠️ Impedimentos: requisitos da vaga fora do seu perfil</p>
                                <div className="tags">{stackFit.missingSkills.map((s) => <span key={s} className="tag-gap">{s}</span>)}</div>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </aside>
                  );
                })()}
              </div>
            </aside>
          ) : viewMode === "table" ? null : (
            <aside className="detail radar-detail-empty">
              <strong>
                Ajuste os filtros para selecionar uma oportunidade.
              </strong>
              <span>
                Os detalhes aparecerão aqui assim que houver uma vaga visível.
              </span>
            </aside>
          )}
        </div>
      </section>
      {detailJob && (
        <div className="modal-backdrop" onClick={() => setDetailJob(null)}>
          <section
            className="modal job-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Detalhes da vaga ${detailJob.title}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setDetailJob(null)}
              aria-label="Fechar detalhes"
            >
              ×
            </button>
            <div className="job-detail-heading">
              <div className="fit-badge">
                <strong>{detailJob.scored ? detailJob.score : "—"}</strong>
                <small>{detailJob.scored ? "FIT" : "SEM SCORE"}</small>
              </div>
              <div>
                <p className="eyebrow">ANÁLISE DE ADERÊNCIA</p>
                <small>
                  {detailJob.stack.slice(0, 3).join(" · ")} · {detailJob.mode}
                </small>
              </div>
            </div>
            <h2>{detailJob.title}</h2>
            <p className="job-detail-meta">
              {detailJob.company} · {detailJob.location} ({detailJob.mode})
            </p>
            <div className="match-reasons">
              <h4>COMO O SCORE FOI CALCULADO</h4>
              {detailJob.reasons.map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </div>
            {profileMasteredSkills.length > 0 && (() => {
              const missingSkills = analyzeStackFit(detailJob.stack, profileMasteredSkills).missingSkills.slice(0, 2);
              return missingSkills.length > 0 ? (
                <div className="match-improve">
                  <h4>COMO MELHORAR</h4>
                  {missingSkills.map((skill) => (
                    <span key={skill}>
                      ＋ Adicionar <strong>{skill}</strong> ao perfil pode aumentar o score nesta vaga
                    </span>
                  ))}
                </div>
              ) : null;
            })()}
            <div className="job-detail-buttons">
              <button
                className="linkedin-action"
                title="Abrir candidatura"
                onClick={() => openJobApplication(detailJob)}
              >
                {jobProviderLabel(detailJob)}
              </button>
              <button className="primary" onClick={() => save(detailJob)}>
                Salvar oportunidade
              </button>
            </div>
            <section className="job-description">
              <div className="detail-section-title">
                <h4>DESCRIÇÃO DA VAGA</h4>
                <div>
                  <span>
                    {jobDetail?.descriptionSource === "linkedin"
                      ? "Fonte oficial"
                      : jobDetail?.descriptionSource === "stored"
                        ? "Descrição enriquecida"
                        : "Dados do alerta"}
                  </span>
                  <button
                    onClick={copyDescription}
                    disabled={
                      detailLoading ||
                      !(jobDetail?.description || detailJob.description)
                    }
                  >
                    {descriptionCopied ? "Copiada ✓" : "Copiar descrição"}
                  </button>
                </div>
              </div>
              {detailLoading ? (
                <p className="detail-loading">Buscando a descrição completa…</p>
              ) : (
                <div className="description-scroll">
                  <DescriptionContent
                    text={
                      jobDetail?.description ||
                      detailJob.description ||
                      "A descrição completa ainda não está disponível para esta vaga."
                    }
                  />
                </div>
              )}
              <p className="external-use-hint">
                Copie a descrição para usar no ChatGPT ou em outra ferramenta
                externa.
              </p>
            </section>
          </section>
        </div>
      )}
      {usersOpen && isOwner && <UserManagement close={() => setUsersOpen(false)} />}
      {qualityOpen && <DataQuality close={() => setQualityOpen(false)} />}
      {auditOpen && <AuditTrail close={() => setAuditOpen(false)} />}
      {triageOpen && isOwner && <TriageReport
        close={() => setTriageOpen(false)}
        sourceId={sourceFilter === "all" ? undefined : sourceFilter}
        sourceLabel={sourceFilter === "all" ? undefined : jobFilterOptions.sources.find(option => option.id === sourceFilter)?.label}
      />}
      {importReportRunId && <ImportRunReport runId={importReportRunId} close={() => setImportReportRunId(null)} />}
      {monitorOpen && <Monitoring close={() => setMonitorOpen(false)} />}
      {analyticsOpen && <Analytics close={() => setAnalyticsOpen(false)} />}
      {alertsOpen && <AlertCenter close={() => setAlertsOpen(false)} />}
      {importing && (
        <div className="modal-backdrop" onClick={() => setImporting(false)}>
          <section
            className="modal import-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setImporting(false)}>
              ×
            </button>
            <p className="eyebrow">PAINEL ADMINISTRATIVO</p>
            <h2>Importar vagas do LinkedIn</h2>
            <p>
              Envie o arquivo gerado pelo LinkedIn Job Collector. O Radar
              reconhece os campos automaticamente e atualiza vagas repetidas.
            </p>
            {importFile ? (
              <div className="import-ready">
                <span className="import-file-icon">✓</span>
                <div>
                  <strong>{importFile}</strong>
                  <small>
                    {importCount.toLocaleString("pt-BR")}{" "}
                    {importCount === 1
                      ? "vaga encontrada"
                      : "vagas encontradas"}{" "}
                    · pronto para importar
                  </small>
                </div>
                <button onClick={clearImportFile} aria-label="Remover arquivo">
                  Remover
                </button>
              </div>
            ) : (
              <label className="import-picker">
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void loadImportFile(file);
                  }}
                />
                <span className="import-upload-icon">↑</span>
                <strong>Escolha o arquivo do coletor</strong>
                <span>CSV ou JSON · máximo de 2 MB e 2.000 vagas</span>
                <em>Selecionar arquivo</em>
              </label>
            )}
            <div className="import-help">
              <span>✓ Campos convertidos automaticamente</span>
              <span>✓ Duplicadas são atualizadas</span>
            </div>
            {message && <div className="notice">{message}</div>}
            <div className="import-footer">
              <a
                className="csv-template"
                href="/modelo-importacao.csv"
                download
              >
                Baixar modelo CSV
              </a>
              <button className="primary" disabled={!json} onClick={runImport}>
                {message === "Importando…" ? "Importando…" : "Importar vagas"}
              </button>
            </div>
          </section>
        </div>
      )}
      {linkedinOpen && (
        <LinkedInExtension
          close={() => setLinkedInOpen(false)}
          openImport={() => setImporting(true)}
        />
      )}
      {apinfoOpen && (
        <ApinfoExtension
          close={() => setApinfoOpen(false)}
          openImport={() => setImporting(true)}
        />
      )}
      {sourcesOpen && (
        <div className="modal-backdrop" onClick={() => setSourcesOpen(false)}>
          <section
            className="modal source-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setSourcesOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">ORIGENS DE VAGAS</p>
            <h2>Empresas e integrações</h2>
            <p>Gerencie o catálogo, as fontes ativas e as integrações.</p>
            <SourceList
              refreshKey={sourceVersion}
              onStart={(catalogId, name) => collectNow(catalogId, name)}
              onActivateAll={activateCatalog}
              onCollectAll={() => collectNow()}
            />
            {message && <div className="notice">{message}</div>}
            {collectionResults.length > 0 && (
              <div className="collection-results" aria-live="polite">
                {collectionResults.map((outcome) => (
                  <p key={outcome.id} className={outcome.status}>
                    <b>{outcome.name}</b>
                    {outcome.status === "completed"
                      ? `: ${outcome.received} encontradas · ${outcome.inserted} novas · ${outcome.updated} atualizadas`
                      : `: ${outcome.error ?? "Falha na coleta"}`}
                  </p>
                ))}
              </div>
            )}
            <details className="add-source">
              <summary>＋ Adicionar nova empresa</summary>
              <p>
                Informe a página pública onde a empresa divulga vagas. O Radar
                fará a coleta automaticamente.
              </p>
              <label>
                Plataforma
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                >
                  <option value="greenhouse">Greenhouse</option>
                  <option value="lever">Lever</option>
                  <option value="ashby">Ashby</option>
                </select>
              </label>
              <label>
                Link da página de carreiras
                <input
                  value={careerUrl}
                  onChange={(e) => updateCareerUrl(e.target.value)}
                  placeholder={
                    provider === "greenhouse"
                      ? "https://boards.greenhouse.io/nubank"
                      : provider === "lever"
                        ? "https://jobs.lever.co/nubank"
                        : "https://jobs.ashbyhq.com/nubank"
                  }
                />
              </label>
              <label>
                Empresa das vagas{" "}
                <small>Nome que aparecerá nas vagas coletadas.</small>
                <input
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="Ex.: Nubank"
                />
              </label>
              <div className="source-actions">
                <button onClick={() => addSource(true)}>Salvar e testar</button>
                <button onClick={() => addSource()}>Cadastrar fonte</button>
              </div>
              {slugWarning && (
                <div className="slug-warning">
                  <strong>⚠ Slug suspeito — revisão recomendada</strong>
                  <ul>
                    {slugWarning.map((reason, i) => <li key={i}>{reason}</li>)}
                  </ul>
                  <p>Slugs curtos ou genéricos costumam colidir com outras empresas na mesma plataforma ATS, retornando vagas incorretas.</p>
                  <div className="source-actions">
                    <button onClick={() => addSource(true, true)}>Testar mesmo assim</button>
                    <button onClick={() => addSource(false, true)}>Adicionar mesmo assim</button>
                  </div>
                </div>
              )}
            </details>
          </section>
        </div>
      )}
      {pipelineOpen && (
        <div className="modal-backdrop" onClick={() => setPipelineOpen(false)}>
          <section
            className="modal pipeline-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              onClick={() => setPipelineOpen(false)}
            >
              ×
            </button>
            <p className="eyebrow">ACOMPANHAMENTO DE CANDIDATURAS</p>
            <h2>Meu pipeline</h2>
            <p>
              Mova cada oportunidade entre as etapas e registre suas próximas
              ações.
            </p>
            {message && <div className="notice">{message}</div>}
            {pipelineLoading ? (
              <div className="pipeline-empty">Carregando seu pipeline…</div>
            ) : (
              <div className="kanban">
                {pipelineStages.map((stage) => (
                  <section className="kanban-column" key={stage.id}>
                    <header>
                      <strong>{stage.label}</strong>
                      <span>
                        {
                          pipelineItems.filter(
                            (item) => item.stage === stage.id,
                          ).length
                        }
                      </span>
                    </header>
                    {pipelineItems
                      .filter((item) => item.stage === stage.id)
                      .map((item) => (
                        <article className="pipeline-card" key={item.id}>
                          <small>{item.company}</small>
                          <h3>{item.title}</h3>
                          <p>
                            {item.location || "Local não informado"} ·{" "}
                            {item.workMode || "Modalidade não informada"}
                          </p>
                          <select
                            aria-label={`Status de ${item.title}`}
                            value={item.stage}
                            onChange={(e) =>
                              updatePipeline(
                                item.id,
                                e.target.value,
                                item.note ?? "",
                              )
                            }
                          >
                            {pipelineStages.map((option) => (
                              <option value={option.id} key={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={item.note ?? ""}
                            onChange={(e) =>
                              setPipelineItems((current) =>
                                current.map((row) =>
                                  row.id === item.id
                                    ? { ...row, note: e.target.value }
                                    : row,
                                ),
                              )
                            }
                            placeholder="Anotações e próxima ação"
                          />
                          <div className="pipeline-actions">
                            <button
                              onClick={() =>
                                updatePipeline(
                                  item.id,
                                  item.stage,
                                  item.note ?? "",
                                )
                              }
                            >
                              Salvar nota
                            </button>
                            <button onClick={() => removeFromPipeline(item.id)}>
                              Remover
                            </button>
                            <button
                              onClick={() =>
                                item.url && open(item.url, "_blank")
                              }
                            >
                              Abrir vaga ↗
                            </button>
                          </div>
                        </article>
                      ))}
                  </section>
                ))}
              </div>
            )}
            {!pipelineLoading && pipelineItems.length === 0 && (
              <div className="pipeline-empty">
                Seu pipeline ainda está vazio. Salve uma vaga no Radar para
                começar.
              </div>
            )}
          </section>
        </div>
      )}
      {preferencesOpen && (
        <ProfilePreferences
          value={profileChoices}
          onChange={setProfileChoices}
          onSave={() => void saveProfile()}
          onClose={() => setPreferencesOpen(false)}
          message={message}
          isAdmin={isAdmin}
          isOwner={isOwner}
          aiStatus={aiStatus}
        />
      )}
      {gmailOpen && (
        <div className="modal-backdrop" onClick={() => setGmailOpen(false)}>
          <section
            className="modal gmail-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setGmailOpen(false)}>
              ×
            </button>
            <p className="eyebrow">INTEGRAÇÃO ADMINISTRATIVA</p>
            <h2>Gmail RadarVagas</h2>
            <p>
              A ponte lê somente mensagens da etiqueta RadarVagas, envia alertas
              do LinkedIn ao banco e entrega seu resumo diário, sem armazenar
              sua senha.
            </p>
            <div className="gmail-status">
              <span>1</span>
              <div>
                <strong>Crie uma chave exclusiva</strong>
                <small>
                  Use pelo menos 24 caracteres e guarde-a para configurar o
                  Google.
                </small>
                <input
                  type="password"
                  value={gmailSecret}
                  onChange={(event) => setGmailSecret(event.target.value)}
                  placeholder="Chave exclusiva do Gmail"
                />
              </div>
              <button onClick={configureGmail}>Salvar</button>
            </div>
            <div className="gmail-status">
              <span>2</span>
              <div>
                <strong>Baixe e autorize o conector</strong>
                <small>
                  Cole o arquivo em script.google.com e salve a mesma chave como
                  RADAR_SECRET.
                </small>
              </div>
              <a href="/gmail-radarvagas.gs" download>
                Conector
              </a>
            </div>
            <div className="gmail-status">
              <span>3</span>
              <div>
                <strong>Ative a coleta e o resumo diário</strong>
                <small>
                  Execute importarRadarVagas para testar e instalarColetaDiaria
                  uma vez para automatizar às 8h.
                </small>
              </div>
            </div>
            {message && <div className="notice">{message}</div>}
            <div className="notice">
              <b>Integração completa:</b> alertas geram vagas, candidaturas
              atualizam o pipeline, fontes oficiais enriquecem descrições e as
              melhores oportunidades chegam por e-mail.
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
