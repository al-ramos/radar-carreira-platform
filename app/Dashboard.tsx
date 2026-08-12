"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import AlertCenter from "./AlertCenter";
import Analytics from "./Analytics";
import Monitoring from "./Monitoring";
import SourceList from "./SourceList";
import AuditTrail from "./AuditTrail";
import DataQuality from "./DataQuality";
import UserManagement from "./UserManagement";
import LinkedInExtension from "./LinkedInExtension";
import ApinfoExtension from "./ApinfoExtension";
import ProfilePreferences from "./ProfilePreferences";
import {
  emptyProfileChoices,
  ProfileChoices,
  SENIORITY_OPTIONS,
  SKILL_OPTIONS,
  WORK_MODE_OPTIONS,
} from "../lib/profile-options";
import { parseCareerSource } from "../lib/career-source";
import { isOwnerEmail } from "../lib/access";
import { analyzeStackFit, computeVerdict, VerdictResult } from "../lib/verdict";
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
  url?: string;
  applyUrl?: string;
  contactEmail?: string;
  contactSubject?: string;
  externalId?: string;
  description?: string;
  stack?: string[];
  reasons?: string[];
};
type PipelineJob = ApiJob & { stage: string; note?: string };
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
const JOBS_FETCH_ATTEMPTS = 2;
const JOBS_RETRY_BASE_DELAY_MS = 350;

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
      const response = await fetch(url, { cache: "no-store", signal });
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
    const fallbackResponse = await fetch(fallbackUrl, { cache: "no-store", signal });
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
  "Qualidade",
  "Usuários",
  "Extensão LinkedIn",
  "Extensão APinfo",
  "Gmail RadarVagas",
  "Fontes",
  "Importações",
  "Configurações",
];
// Mesmo critério usado no backend (app/api/jobs/route.ts) e na busca da
// descrição oficial (app/api/jobs/detail/route.ts): a URL da vaga aponta
// para o LinkedIn. Cobre tanto a extensão do LinkedIn quanto os alertas
// importados por e-mail (Gmail RadarVagas).
const isLinkedInJob = (job: Job) =>
  Boolean(job.url && /linkedin\.com/i.test(job.url));

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
  age: j.publishedAt
    ? new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" }).format(
        -Math.max(
          1,
          Math.round((Date.now() - new Date(j.publishedAt).getTime()) / 36e5),
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
  contactEmail: j.contactEmail,
  contactSubject: j.contactSubject,
  externalId: j.externalId,
  publishedAt: j.publishedAt,
  description: j.description,
});

const formatJobDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
        new Date(value),
      )
    : "Não informada";

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
    [sortOrder, setSortOrder] = useState<"score" | "recent">("score"),
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
    [jobsRefreshVersion, setJobsRefreshVersion] = useState(0);
  const [slugWarning, setSlugWarning] = useState<string[] | null>(null);
  const [collectionResults, setCollectionResults] = useState<
    CollectionOutcome[]
  >([]);
  const [totalJobs, setTotalJobs] = useState<number | null>(null);
  const [sourcesCount, setSourcesCount] = useState<number | null>(null);
  const loadedJobsRef = useRef<Job[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [profileMasteredSkills, setProfileMasteredSkills] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "linkedin" | "apinfo" | "other"
  >("all");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [profileMinScore, setProfileMinScore] = useState(60);
  const [gmailOpen, setGmailOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [linkedinOpen, setLinkedInOpen] = useState(false);
  const [apinfoOpen, setApinfoOpen] = useState(false);
  const [gmailSecret, setGmailSecret] = useState("");
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [descriptionCopied, setDescriptionCopied] = useState(false);
  const [shareMenuJobId, setShareMenuJobId] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Captura de contato do APinfo pedida à extensão a partir do próprio
  // Radar — ver captureApinfoContact/buildContactMailto e o useEffect que
  // escuta a resposta da extensão (RADAR_CAPTURE_CONTACT_RESULT).
  const [contactCapturing, setContactCapturing] = useState(false);
  const [contactCaptureMsg, setContactCaptureMsg] = useState<{ text: string; error: boolean } | null>(null);
  const contactRequestRef = useRef<{ requestId: string; jobId: string } | null>(null);
  const contactRequestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // A resposta de contingência não possui perfil nem score. Não deixamos que
  // o corte salvo esconda toda a lista enquanto a personalização se recupera.
  const visibleMinScore = simplifiedList ? 0 : effectiveMinScore;
  const profileLoading = !profileReady || mode === "loading";
  const personalizationUnavailable = !profileLoading && simplifiedList;
  const personalizationPending = profileLoading || simplifiedList;
  // ── Persistência de estado UI no sessionStorage (sobrevive ao F5) ──────────
  const jobListRef = useRef<HTMLDivElement>(null);
  const simplifiedRetryCountRef = useRef(0);
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
      if (period) params.set("period", period);
      if (sourceFilter !== "all") params.set("sourceType", sourceFilter);
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (!simplifiedList && effectiveMinScore > 0) params.set("minScore", String(effectiveMinScore));
      if (pipelineFilter !== "all") params.set("pipeline", pipelineFilter);
      if (!simplifiedList && verdictFilter !== "all") params.set("verdict", verdictFilter);
      return params.toString();
    },
    [period, sourceFilter, debouncedQuery, effectiveMinScore, pipelineFilter, verdictFilter, simplifiedList],
  );
  useEffect(() => {
    if (!profileReady) return;
    const controller = new AbortController();
    fetchJobsWithRetry(`/api/jobs?${buildJobsParams(1)}`, controller.signal)
      .then((data) => {
        const next = (data.jobs ?? [])
          .map(adapt)
          .sort((a: Job, b: Job) => b.score - a.score);
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
        setPeriod((current) => current ?? data.period ?? "24");
        setSimplifiedList(Boolean(data.degraded));
        setMode("database");
        setMessage((current) => {
          if (data.degraded) {
            return "Exibindo a lista em modo simplificado enquanto a personalização se recupera.";
          }
          return current.startsWith("O Radar está temporariamente indisponível.") ||
            current === "Não foi possível atualizar agora. Mantendo a última lista carregada."
            ? ""
            : current;
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        if (loadedJobsRef.current.length) {
          setMode("database");
          setMessage("Não foi possível atualizar agora. Mantendo a última lista carregada.");
          return;
        }
        setMode("unavailable");
        setMessage("O Radar está temporariamente indisponível. Tentaremos novamente automaticamente.");
      });
    return () => controller.abort();
  }, [period, sourceFilter, debouncedQuery, effectiveMinScore, pipelineFilter, verdictFilter, buildJobsParams, jobsRefreshVersion, profileReady]);
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setCurrentUser(data.user);
        setProfileMinScore(Number(data.profile?.minScore ?? 60));
        if (Array.isArray(data.profile?.masteredSkills)) {
          setProfileMasteredSkills(data.profile.masteredSkills as string[]);
        }
        // Carrega pipeline automaticamente ao confirmar usuário autenticado
        if (data.user) {
          fetch("/api/pipeline")
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
      .catch(() => setCurrentUser(null))
      .finally(() => setProfileReady(true));
  }, []);
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
      }, profileMasteredSkills));
    });
    return map;
  }, [items, profileMasteredSkills]);
  /** Cor do trilho do slider — mesmos limiares usados no score das vagas. */
  const fitFilterColor =
    effectiveMinScore >= 80 ? "#2e6b3e" : effectiveMinScore >= 60 ? "#7a6200" : effectiveMinScore > 0 ? "#b04a1a" : "#173f32";
  /** Posição do polegar do slider nativo (múltiplo de 10; "profile" arredonda). */
  const fitFilterSliderValue =
    fitFilter === "profile" ? Math.round(profileMinScore / 10) * 10 : fitFilter;
  const activeFilterCount = [
    sourceFilter !== "all",
    pipelineFilter !== "all",
    !personalizationPending && verdictFilter !== "all",
    !personalizationPending && fitFilter !== 0,
  ].filter(Boolean).length;
  const filtered = useMemo(
    () =>
      items.filter((j) => {
        // A busca principal promete cargo, empresa ou tecnologia. Não usamos a
        // descrição aqui: palavras comuns no texto longo (como "squad") faziam
        // parecer que o campo não estava filtrando a lista.
        const text = `${j.title} ${j.company} ${j.location} ${j.seniority ?? ""} ${j.stack.join(" ")}`.toLowerCase();
        const searchQuery = query.trim().toLowerCase();
        const matchesSource =
          sourceFilter === "all" ||
          (sourceFilter === "linkedin" && isLinkedInJob(j)) ||
          (sourceFilter === "apinfo" && isApinfoJob(j)) ||
          (sourceFilter === "other" && !isLinkedInJob(j) && !isApinfoJob(j));
        return (
          j.score >= visibleMinScore &&
          (!searchQuery || text.includes(searchQuery)) &&
          matchesSource &&
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
      sourceFilter,
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
        return new Date(right.publishedAt ?? 0).getTime() - new Date(left.publishedAt ?? 0).getTime();
      }
      return right.score - left.score || new Date(right.publishedAt ?? 0).getTime() - new Date(left.publishedAt ?? 0).getTime();
    }),
    [filtered, sortOrder],
  );
  /** Baixa o relatório em Excel/CSV com exatamente as vagas visíveis na tela
   *  (mesma lista e ordem exibidas) — score e veredito são os
   *  já calculados no client, para não haver divergência com o que a pessoa
   *  está vendo no momento do clique. */
  async function downloadReport() {
    if (reportLoading || filtered.length === 0) return;
    setReportLoading(true);
    try {
    const rows = orderedJobs.map((job) => ({
        id: job.id,
        score: job.score,
        verdict: verdictMap.get(job.id)
          ? `${verdictMap.get(job.id)!.emoji} ${verdictMap.get(job.id)!.label}`
          : undefined,
      }));
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
    } catch {
      setMessage("Não foi possível gerar o relatório. Tente novamente.");
    } finally {
      setReportLoading(false);
    }
  }
  const selectedJob =
    filtered.find((job) => job.id === selected.id) ?? orderedJobs[0] ?? null;
  function clearRadarFilters() {
    setQuery("");
    setFitFilter(0);
    setPeriod("all");
    setSourceFilter("all");
    setPipelineFilter("all");
    setVerdictFilter("all");
  }
  async function goToJobsPage(page: number) {
    if (page === currentPage || page < 1) return;
    setLoadingMore(true);
    try {
      const controller = new AbortController();
      const data = await fetchJobsWithRetry(`/api/jobs?${buildJobsParams(page)}`, controller.signal);
      const next: Job[] = (data.jobs ?? []).map(adapt).sort((a: Job, b: Job) => b.score - a.score);
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
    const r = await fetch("/api/profile");
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
      setFitFilter("profile");
      setTimeout(() => location.reload(), 900);
    }
  }
  /** Seleciona uma vaga, carrega descrição enriquecida e registra visualização no pipeline */
  function selectJob(job: Job) {
    setSelected(job);
    setAnalysisOpen(false);
    void loadJobDetail(job);
    if (!job.id.startsWith("demo") && currentUser) {
      // Optimistic update: marca como viewed localmente sem rebaixar estágio existente
      setPipelineItems((prev) => {
        if (prev.some((p) => p.id === job.id)) return prev;
        return [...prev, { id: job.id, stage: "viewed" } as PipelineJob];
      });
      void fetch("/api/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.id, stage: "viewed" }),
      });
    }
  }
  /** Helper centralizado: atualiza estágio no servidor e no estado local */
  async function updateStage(jobId: string, stage: string, toast?: string) {
    const r = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, stage }),
    });
    if (r.ok) {
      if (toast) setMessage(toast);
      setPipelineItems((prev) => {
        const exists = prev.some((p) => p.id === jobId);
        if (exists) return prev.map((p) => p.id === jobId ? { ...p, stage } : p);
        return [...prev, { id: jobId, stage } as PipelineJob];
      });
    } else {
      setMessage("Entre com sua conta para atualizar o pipeline.");
    }
    return r.ok;
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
    const r = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, stage, note }),
    });
    if (r.ok) {
      setPipelineItems((current) =>
        current.map((item) =>
          item.id === jobId ? { ...item, stage, note } : item,
        ),
      );
      setMessage("Pipeline atualizado.");
    } else setMessage("Não foi possível atualizar o pipeline.");
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
      if (Array.isArray(data.stack) && data.stack.length)
        setItems((current) =>
          current.map((item) =>
            item.id === job.id ? { ...item, stack: data.stack } : item,
          ),
        );
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
    const matchReasonRaw = (job.reasons ?? []).find((r) => r.startsWith("✅ Competências encontradas"));
    const matchedSkills = matchReasonRaw
      ? matchReasonRaw.replace(/^✅ Competências encontradas \(\d+ de \d+\):\s*/, "").replace(/\s*\(\+\d+\)$/, "").split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const extraSkills = profileMasteredSkills
      .filter((skill) => !matchedSkills.some((m) => m.toLowerCase() === skill.toLowerCase()))
      .slice(0, 3);
    const seniorityIntro = profileChoices.seniority.length
      ? `Atuo como profissional de TI nível ${profileChoices.seniority.join("/")}. `
      : "";
    const skillsLine = matchedSkills.length
      ? `${seniorityIntro}Tenho experiência com ${matchedSkills.join(", ")}, que ${matchedSkills.length === 1 ? "aparece" : "aparecem"} entre os requisitos da vaga${
          extraSkills.length ? `, além de ${extraSkills.join(", ")}` : ""
        }.\n\n`
      : seniorityIntro
        ? `${seniorityIntro}\n\n`
        : "";
    const body =
      `Olá,\n\n` +
      `Tenho interesse na vaga de ${job.title} na ${job.company}${job.externalId ? ` (código ${job.externalId})` : ""}.\n\n` +
      skillsLine +
      `Segue meu contato para conversarmos.`;
    const query = [
      job.contactSubject ? `subject=${encodeURIComponent(job.contactSubject)}` : null,
      `body=${encodeURIComponent(body)}`,
    ].filter(Boolean).join("&");
    return `mailto:${job.contactEmail}?${query}`;
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
    setContactCaptureMsg({ text: "Lendo a aba do APinfo…", error: false });
    if (contactRequestTimerRef.current) clearTimeout(contactRequestTimerRef.current);
    contactRequestTimerRef.current = setTimeout(() => {
      if (contactRequestRef.current?.requestId !== requestId) return;
      contactRequestRef.current = null;
      contactRequestTimerRef.current = null;
      setContactCapturing(false);
      setContactCaptureMsg({
        text: "A extensão não respondeu. Recarregue a extensão do APinfo e atualize esta página.",
        error: true,
      });
    }, 12_000);
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
        setContactCaptureMsg({ text: data.error || "Não foi possível capturar o contato.", error: true });
        return;
      }

      void (async () => {
        const r = await fetch(`/api/jobs/${pending.jobId}/contact`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contactEmail: data.email, contactSubject: data.assunto }),
        });
        if (!r.ok) {
          setContactCaptureMsg({ text: "E-mail capturado, mas não foi possível salvar no Radar. Tente de novo.", error: true });
          return;
        }
        setItems((current) =>
          current.map((item) =>
            item.id === pending.jobId ? { ...item, contactEmail: data.email, contactSubject: data.assunto } : item,
          ),
        );
        setContactCaptureMsg({ text: `E-mail capturado: ${data.email}`, error: false });
      })();
    }
    window.addEventListener("message", handleExtensionMessage);
    return () => {
      window.removeEventListener("message", handleExtensionMessage);
      if (contactRequestTimerRef.current) clearTimeout(contactRequestTimerRef.current);
    };
  }, []);
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
      if (item === "Auditoria" || item === "Extensão LinkedIn" || item === "Extensão APinfo") return isOwner;
      return (
        (isAdmin && (item !== "Usuários" || isOwner)) ||
        !new Set(["Auditoria", "Usuários", "Extensão LinkedIn", "Extensão APinfo"]).has(item)
      );
    }),
    icons: Record<string, string> = {
      Radar: "⌁",
      Pipeline: "▦",
      Alertas: "●",
      Métricas: "▥",
      Monitoramento: "◌",
      Auditoria: "≡",
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
              {period === "24"
                ? "ÚLTIMAS 24 HORAS"
                : period === "72"
                  ? "ÚLTIMOS 3 DIAS"
                  : period === "168"
                    ? "ÚLTIMOS 7 DIAS"
                    : "TODAS AS VAGAS"}
              {sourcesCount !== null && sourcesCount > 0
                ? ` · ${sourcesCount} FONTE${sourcesCount !== 1 ? "S" : ""} ATIVA${sourcesCount !== 1 ? "S" : ""}`
                : ""}{" "}
              · {mode === "database" ? "BANCO ATIVO" : "PRÉVIA LOCAL"}
            </p>
            <h1>
              {active === "Radar"
                ? `Seu radar de hoje${currentUser ? `, ${userName.split(" ")[0]}` : ""}`
                : active}
            </h1>
          </div>
          <div className="header-actions">
            {!currentUser && (
              <a className="icon-btn" href="/login?return_to=/">
                Entrar
              </a>
            )}
            {currentUser && (
              <button
                type="button"
                className="icon-btn"
                onClick={downloadReport}
                disabled={personalizationPending || reportLoading || filtered.length === 0}
              >
                {reportLoading ? "Gerando…" : "↓ Relatório Excel"}
              </button>
            )}
            {canManageSources && (
              <button className="primary" onClick={() => setImporting(true)}>
                ＋ Importar vagas
              </button>
            )}
          </div>
        </header>
        {profileLoading ? (
          <div className="notice" role="status">
            Carregando seu perfil e calculando a aderência das vagas…
          </div>
        ) : personalizationUnavailable ? (
          <div className="notice" role="status">
            Seu perfil está salvo. A lista está temporariamente sem aderência enquanto a consulta é recuperada.
          </div>
        ) : message ? (
          <div className="notice">{message}</div>
        ) : null}
        <div className="radar-controls">
          <div className="radar-result-summary">
            <span>
              <strong>{(totalJobs ?? items.length).toLocaleString("pt-BR")}</strong> vagas encontradas
              {totalJobs !== null && totalJobs > items.length && (
                <span className="list-head-dim"> · {items.length} carregadas</span>
              )}
            </span>
          </div>
          <div className="toolbar">
            <div className="search">
              ⌕
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar cargo, empresa ou tecnologia"
              />
            </div>
            <select
              className="radar-source-select"
              aria-label="Origem das vagas"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
            >
              <option value="all">Todas as origens</option>
              <option value="linkedin">LinkedIn</option>
              <option value="apinfo">APinfo</option>
              <option value="other">Outras fontes</option>
            </select>
            <select
              aria-label="Período das vagas"
              onChange={(e) => setPeriod(e.target.value)}
              value={period ?? "24"}
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
          </div>
        </div>
        {!personalizationPending && (
          <div className="score-controls" aria-label="Controles de aderência">
            <div className="score-controls-copy">
              <span className="compact-filter-label">Aderência mínima</span>
              <strong style={{ color: fitFilterColor }}>
                {effectiveMinScore === 0 ? "Sem corte" : `${effectiveMinScore}+ pontos`}
              </strong>
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
                onChange={(event) => setFitFilter(Number(event.target.value))}
                style={{ "--fit-fill": `${fitFilterSliderValue}%`, "--fit-color": fitFilterColor } as CSSProperties}
              />
              <div className="score-controls-foot" aria-hidden="true">
                <span>0</span><span>100</span>
              </div>
            </div>
            <div className="score-controls-actions">
              <button type="button" className={`fit-filter-profile-chip${fitFilter === "profile" ? " active" : ""}`} onClick={() => setFitFilter("profile")}>
                Usar meu perfil ({profileMinScore})
              </button>
              <label className="score-sort">
                <span>Ordenar por</span>
                <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as "score" | "recent")} aria-label="Ordenar vagas">
                  <option value="score">Pontuação</option>
                  <option value="recent">Recentes</option>
                </select>
              </label>
            </div>
            <datalist id="fit-filter-ticks">
              {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((tick) => <option key={tick} value={tick} />)}
            </datalist>
          </div>
        )}
        <div id="radar-filter-panel" className="radar-filter-panel" hidden={!filtersOpen} aria-label="Filtros de vagas">
          <div className="compact-filter-group">
            <span className="compact-filter-label">Pipeline</span>
            <div className="compact-pills" role="group" aria-label="Filtrar por estágio do pipeline">
              {([
                { id: "all", label: "Todas" },
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
                return (
                  <button
                    key={id}
                    type="button"
                    className={pipelineFilter === id ? "active" : ""}
                    onClick={() => setPipelineFilter(id)}
                    aria-pressed={pipelineFilter === id}
                  >
                    {label}{count > 0 && <span>{count}</span>}
                  </button>
                );
              })}
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
                        onClick={() => setVerdictFilter(v)}
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
        <div className="list-status-bar">
          <span>
            {personalizationPending ? (
              <><strong>Carregando vagas</strong><span className="list-head-dim"> · filtros de aderência em preparação</span></>
            ) : (
              <><strong>{filtered.length}</strong>{" "}{filtered.length === 1 ? "vaga" : "vagas"}</>
            )}
            {!personalizationPending && filtered.length < items.length && (
              <>{" "}<span className="list-head-dim">({items.length} carregadas{totalJobs != null && totalJobs > items.length ? ` de ${totalJobs} disponíveis` : ""})</span></>
            )}
            {!personalizationPending && filtered.length === items.length && totalJobs != null && totalJobs > items.length && (
              <>{" "}<span className="list-head-dim">({items.length} carregadas de {totalJobs} disponíveis)</span></>
            )}
            {sourceFilter === "linkedin" && <>{" "}<span className="list-head-badge">só LinkedIn</span></>}
            {sourceFilter === "apinfo" && <>{" "}<span className="list-head-badge">só APinfo</span></>}
            {sourceFilter === "other" && <>{" "}<span className="list-head-badge">só ATS</span></>}
          </span>
          {totalJobs != null && items.length < totalJobs && (
            <span className="list-status-progress">
              <span className="list-status-bar-fill" style={{ width: `${Math.round((items.length / totalJobs) * 100)}%` }} />
            </span>
          )}
          <span className="list-head-dim">por aderência</span>
        </div>
        {totalJobs != null && totalJobs > 50 && (
          <div className="list-pagination">
            <span className="pagination-summary">Página {currentPage} de {Math.ceil(totalJobs / 50)}</span>
            <button
              type="button"
              className="pagination-arrow"
              onClick={() => void goToJobsPage(currentPage - 1)}
              disabled={loadingMore || currentPage <= 1}
              aria-label="Página anterior"
            >
              ‹
            </button>
            {compactPagination(currentPage, Math.ceil(totalJobs / 50)).map((item) =>
              typeof item === "number" ? (
                <button
                  type="button"
                  key={item}
                  className={`pagination-page ${item === currentPage ? "active" : ""}`}
                  onClick={() => void goToJobsPage(item)}
                  disabled={loadingMore}
                  aria-current={item === currentPage ? "page" : undefined}
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
              disabled={loadingMore || currentPage >= Math.ceil(totalJobs / 50)}
              aria-label="Próxima página"
            >
              ›
            </button>
            {typeof fitFilter === "number" && fitFilter < 80 && (
              <button
                type="button"
                className="load-more-refine"
                onClick={() => setFitFilter(80)}
              >
                Ou filtre para aderência de 80% ou mais
              </button>
            )}
          </div>
        )}
        <div className="workspace">
          <div className="job-list" ref={jobListRef} onScroll={handleJobListScroll}>
            {orderedJobs.map((j) => (
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
                    const icons: Record<string, string> = { saved: "🔖", applied: "📨", interview: "🗓", rejected: "✕", archived: "✕" };
                    return icons[stage] ? <span className="card-stage-badge">{icons[stage]}</span> : null;
                  })()}
                </div>
                <div className="job-main">
                  <small>{j.company.toUpperCase()}</small>
                  <h3>{j.title}</h3>
                  <p>
                    ⌖ {j.location} · {j.mode} · {j.age} · 📅 {formatJobDate(j.publishedAt)}
                  </p>
                  <div
                    className="tags job-stack"
                    aria-label="Tecnologias da vaga"
                  >
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
                        <button className="share-menu-item" onClick={() => window.open(links.email, "_blank")}>📧 E-mail</button>
                        <button className="share-menu-item" onClick={() => window.open(links.whatsapp, "_blank")}>💬 WhatsApp</button>
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
          {selectedJob ? (
            <aside className={`detail${analysisOpen ? " detail-analysis-open" : ""}`}>
              <div className="detail-heading">
                <div>
                  <small>{selectedJob.company.toUpperCase()}</small>
                  <h2>{selectedJob.title}</h2>
                  <p>
                    ⌖ {selectedJob.location} · {selectedJob.mode} ·{" "}
                    {selectedJob.age} · 📅 {formatJobDate(selectedJob.publishedAt)}
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
                    <p className="list-head-dim job-detail-source" title="Capturado manualmente na tela de contato — abre um e-mail com mensagem padrão, pronta para revisar antes de enviar">
                      Contato:{" "}
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
                    rejected: "✕ Encerrada",
                    archived: "✕ Encerrada",
                  };
                  return (
                    <div className="stage-selector-wrap">
                      <select
                        className="stage-selector"
                        value={currentStage === "unseen" ? "" : currentStage}
                        aria-label="Estágio no pipeline"
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
                        <option value="" disabled>{stageLabels[currentStage]}</option>
                        <option value="saved">🔖 Salvar</option>
                        <option value="applied">📨 Candidatura</option>
                        <option value="interview">🗓 Entrevista</option>
                        <option value="rejected">✕ Encerrar</option>
                      </select>
                    </div>
                  );
                })()}
                <button
                  className={`analysis-toggle-btn${analysisOpen ? " active" : ""}`}
                  onClick={() => setAnalysisOpen((v) => !v)}
                  title="Análise de candidatura com base no seu perfil"
                >
                  {analysisOpen ? "✕ Fechar análise" : "🔍 Analisar candidatura"}
                </button>
                <button
                  className="primary-job-action"
                  onClick={async () => {
                    // applyUrl (quando presente) é o link que de fato abre a
                    // vaga/candidatura — url pode ser só uma referência
                    // estável (ex.: busca por código no APinfo), usada para
                    // identificar a vaga sem depender de token de sessão.
                    // Sem applyUrl, uma vaga do APinfo precisa do POST real
                    // (não um simples GET) para efetivamente filtrar pelo
                    // código — ver openApinfoJobSearch.
                    if (selectedJob.applyUrl) {
                      open(selectedJob.applyUrl, "_blank");
                    } else if (isApinfoJob(selectedJob) && selectedJob.externalId) {
                      openApinfoJobSearch(selectedJob.externalId);
                    } else if (selectedJob.url) {
                      open(selectedJob.url, "_blank");
                    }
                    if (!selectedJob.id.startsWith("demo")) {
                      const current = pipelineStageMap.get(selectedJob.id);
                      // Avança para Candidatura se ainda não passou desse estágio
                      if (!current || current === "viewed" || current === "saved") {
                        await updateStage(selectedJob.id, "applied", "Registrado como candidatura ✓");
                      }
                    }
                  }}
                >
                  Candidatar
                </button>
                {isApinfoJob(selectedJob) && (
                  <button
                    className="analysis-toggle-btn"
                    disabled={contactCapturing || Boolean(selectedJob.contactEmail)}
                    title={
                      selectedJob.contactEmail
                        ? `Contato já cadastrado: ${selectedJob.contactEmail}`
                        : "Clique em Candidatar, faça login no APinfo até ver Empresa/Email na tela, e clique aqui"
                    }
                    onClick={() => captureApinfoContact(selectedJob)}
                  >
                    {selectedJob.contactEmail
                      ? "E-mail cadastrado"
                      : contactCapturing
                        ? "Capturando…"
                        : "Capturar e-mail"}
                  </button>
                )}
                {selectedJob.contactEmail && (
                  <button
                    className="primary-job-action"
                    title={`Abre seu cliente de e-mail com mensagem pronta para ${selectedJob.contactEmail}`}
                    onClick={() => {
                      const mailto = buildContactMailto(selectedJob);
                      if (mailto) open(mailto, "_blank");
                    }}
                  >
                    ✉ Enviar e-mail
                  </button>
                )}
                {(() => {
                  const links = buildShareLinks(selectedJob);
                  return (
                    <>
                      <button className="analysis-toggle-btn" onClick={() => window.open(links.email, "_blank")}>
                        Encaminhar por e-mail
                      </button>
                      <button className="analysis-toggle-btn" onClick={() => window.open(links.whatsapp, "_blank")}>
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
                  }, profileMasteredSkills);
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
          ) : (
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
              const missingSkills = detailJob.stack
                .filter(
                  (skill) =>
                    !profileMasteredSkills.some(
                      (s) => s.toLowerCase() === skill.toLowerCase(),
                    ),
                )
                .slice(0, 2);
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
                onClick={() => {
                  if (detailJob.applyUrl) {
                    open(detailJob.applyUrl, "_blank");
                  } else if (isApinfoJob(detailJob) && detailJob.externalId) {
                    openApinfoJobSearch(detailJob.externalId);
                  } else if (detailJob.url) {
                    open(detailJob.url, "_blank");
                  }
                }}
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
