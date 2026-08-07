"use client";
import { useEffect, useMemo, useState } from "react";
import AlertCenter from "./AlertCenter";
import Analytics from "./Analytics";
import Monitoring from "./Monitoring";
import SourceList from "./SourceList";
import AuditTrail from "./AuditTrail";
import DataQuality from "./DataQuality";
import UserManagement from "./UserManagement";
import LinkedInExtension from "./LinkedInExtension";
import ProfilePreferences from "./ProfilePreferences";
import {
  emptyProfileChoices,
  ProfileChoices,
  SENIORITY_OPTIONS,
  SKILL_OPTIONS,
  WORK_MODE_OPTIONS,
} from "../lib/profile-options";
import { parseCareerSource } from "../lib/career-source";
type Job = {
  id: string;
  score: number;
  title: string;
  company: string;
  location: string;
  mode: string;
  seniority?: string;
  workMode?: string;
  age: string;
  publishedAt?: string;
  url?: string;
  description?: string;
  stack: string[];
  reasons: string[];
  stage: string;
};
type ApiJob = {
  id: string;
  score?: number;
  title: string;
  company: string;
  location?: string;
  workMode?: string;
  seniority?: string;
  publishedAt?: string;
  url?: string;
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
function DescriptionContent({ text }: { text: string }) {
  const clean = text.replace(/\s+/g, " ").trim(),
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
  return (
    <div className="radar-description-content">
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <h5 key={`${block.text}-${index}`}>{block.text}</h5>
        ) : (
          <p key={index}>{block.text}</p>
        ),
      )}
    </div>
  );
}
const demo: Job[] = [
  {
    id: "demo-1",
    score: 94,
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
  score: j.score ?? 70,
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
  description: j.description,
});
export default function Dashboard() {
  const [active, setActive] = useState("Radar"),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<Job[]>(demo),
    [selected, setSelected] = useState<Job>(demo[0]),
    [fitFilter, setFitFilter] = useState<"profile" | "all" | "70" | "80">(
      "profile",
    ),
    [period, setPeriod] = useState<string | null>(null),
    [mode, setMode] = useState("preview"),
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
    [sourceVersion, setSourceVersion] = useState(0);
  const [slugWarning, setSlugWarning] = useState<string[] | null>(null);
  const [collectionResults, setCollectionResults] = useState<
    CollectionOutcome[]
  >([]);
  const [totalJobs, setTotalJobs] = useState<number | null>(null);
  const [totalLinkedIn, setTotalLinkedIn] = useState<number | null>(null);
  const [totalOtherSources, setTotalOtherSources] = useState<number | null>(
    null,
  );
  const [sourcesCount, setSourcesCount] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [profileMasteredSkills, setProfileMasteredSkills] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"all" | "linkedin" | "other">(
    "all",
  );
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
  const [gmailSecret, setGmailSecret] = useState("");
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [descriptionCopied, setDescriptionCopied] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [profileChoices, setProfileChoices] =
    useState<ProfileChoices>(emptyProfileChoices);
  const [stackFilter, setStackFilter] = useState("");
  const [seniorityFilter, setSeniorityFilter] = useState("");
  const [workModeFilter, setWorkModeFilter] = useState("");
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
  useEffect(() => {
    const sourceParam = sourceFilter !== "all" ? `&sourceType=${sourceFilter}` : "";
    fetch(`/api/jobs?page=1&limit=50${period ? `&period=${period}` : ""}${sourceParam}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const next = (data.jobs ?? [])
          .map(adapt)
          .sort((a: Job, b: Job) => b.score - a.score);
        setItems(next);
        setCurrentPage(1);
        if (next.length) setSelected(next[0]);
        setTotalJobs(typeof data.total === "number" ? data.total : next.length);
        setTotalLinkedIn(
          typeof data.totalLinkedIn === "number" ? data.totalLinkedIn : null,
        );
        setTotalOtherSources(
          typeof data.totalOtherSources === "number"
            ? data.totalOtherSources
            : null,
        );
        setSourcesCount(typeof data.sourcesCount === "number" ? data.sourcesCount : null);
        setHasMore(data.hasMore === true);
        setPeriod((current) => current ?? data.period ?? "24");
        setMode("database");
      })
      .catch(() => setMode("preview"));
  }, [period, sourceFilter]);
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setCurrentUser(data.user);
        setProfileMinScore(Number(data.profile?.minScore ?? 60));
        if (Array.isArray(data.profile?.masteredSkills)) {
          setProfileMasteredSkills(data.profile.masteredSkills as string[]);
        }
      })
      .catch(() => setCurrentUser(null));
  }, []);
  const stackFilterOptions = useMemo(
    () =>
      [
        ...new Set([...SKILL_OPTIONS, ...items.flatMap((job) => job.stack)]),
      ].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [items],
  );
  const seniorityFilterOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...SENIORITY_OPTIONS,
            ...items
              .map((job) => job.seniority)
              .filter((value): value is string => Boolean(value)),
          ],
        ),
      ].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [items],
  );
  const effectiveMinScore =
    fitFilter === "profile"
      ? profileMinScore
      : fitFilter === "all"
        ? 0
        : Number(fitFilter);
  const filtered = useMemo(
    () =>
      items.filter((j) => {
        const text =
          `${j.title} ${j.company} ${j.location} ${j.seniority ?? ""} ${j.stack.join(" ")} ${j.description ?? ""}`.toLowerCase();
        return (
          j.score >= effectiveMinScore &&
          text.includes(query.toLowerCase()) &&
          (!stackFilter ||
            j.stack.some(
              (stack) => stack.toLowerCase() === stackFilter.toLowerCase(),
            ) ||
            text.includes(stackFilter.toLowerCase())) &&
          (!seniorityFilter ||
            j.seniority
              ?.toLowerCase()
              .includes(seniorityFilter.toLowerCase())) &&
          (!workModeFilter || j.mode === workModeFilter) &&
          (sourceFilter === "all" ||
            (sourceFilter === "linkedin") === isLinkedInJob(j))
        );
      }),
    [
      items,
      query,
      effectiveMinScore,
      stackFilter,
      seniorityFilter,
      workModeFilter,
      sourceFilter,
    ],
  );
  // Contagem das vagas atualmente carregadas (até 250, dentro do período
  // selecionado), usada para o detalhamento por fonte no resumo do topo
  // quando a API ainda não respondeu com os totais reais do banco.
  const loadedLinkedIn = useMemo(
    () => items.filter(isLinkedInJob).length,
    [items],
  );
  const loadedOtherSources = items.length - loadedLinkedIn;
  const selectedJob =
    filtered.find((job) => job.id === selected.id) ?? filtered[0] ?? null;
  function clearRadarFilters() {
    setQuery("");
    setFitFilter("all");
    setPeriod("all");
    setStackFilter("");
    setSeniorityFilter("");
    setWorkModeFilter("");
    setSourceFilter("all");
  }
  async function loadMoreJobs() {
    setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const sourceParam = sourceFilter !== "all" ? `&sourceType=${sourceFilter}` : "";
      const r = await fetch(
        `/api/jobs?page=${nextPage}&limit=50${period ? `&period=${period}` : ""}${sourceParam}`,
      );
      if (!r.ok) return;
      const data = await r.json();
      const next: Job[] = (data.jobs ?? []).map(adapt);
      setItems((current) => {
        const existingIds = new Set(current.map((j) => j.id));
        const newItems = next.filter((j) => !existingIds.has(j.id));
        return [...current, ...newItems].sort((a, b) => b.score - a.score);
      });
      setCurrentPage(nextPage);
      setHasMore(data.hasMore === true);
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
    const sourceParam = sourceFilter !== "all" ? `&sourceType=${sourceFilter}` : "";
    const jobsResponse = await fetch(
      `/api/jobs?page=1&limit=50${period ? `&period=${period}` : ""}${sourceParam}`,
    );
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
      setHasMore(jobsData.hasMore === true);
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
    setMessage(
      r.ok
        ? "Preferências salvas. Recalculando seu radar…"
        : "Entre com sua conta para salvar o perfil.",
    );
    if (r.ok) {
      setProfileMinScore(profileChoices.minScore);
      setFitFilter("profile");
      setTimeout(() => location.reload(), 900);
    }
  }
  async function save(job: Job) {
    if (job.id.startsWith("demo")) {
      setMessage("Entre na versão publicada para salvar vagas reais.");
      return;
    }
    const r = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.id, stage: "saved" }),
    });
    setMessage(
      r.ok ? "Vaga salva no seu pipeline." : "Entre com sua conta para salvar.",
    );
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
  function openJobDetail(job: Job) {
    setDescriptionCopied(false);
    setDetailJob(job);
    void loadJobDetail(job);
  }
  async function copyDescription() {
    const description = jobDetail?.description || detailJob?.description;
    if (!description) return;
    await navigator.clipboard.writeText(description);
    setDescriptionCopied(true);
    setTimeout(() => setDescriptionCopied(false), 1800);
  }
  const pipelineStages = [
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
    isOwner = currentUser?.email.toLowerCase() === "alexsandro.ramos@gmail.com",
    visibleNav = nav.filter(
      (item) =>
        (isAdmin && (item !== "Usuários" || isOwner)) ||
        !new Set([
          "Monitoramento",
          "Auditoria",
          "Qualidade",
          "Usuários",
          "Extensão LinkedIn",
          "Gmail RadarVagas",
          "Fontes",
          "Importações",
        ]).has(item),
    ),
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
      "Gmail RadarVagas": "✉",
      Fontes: "◉",
      Importações: "↥",
      Configurações: "⚙",
    };
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R</span>
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
                    : "TODAS AS VAGAS"}{" "}
              · {mode === "database" ? "BANCO ATIVO" : "PRÉVIA LOCAL"}
            </p>
            <h1>
              {active === "Radar"
                ? `Seu radar de hoje${currentUser ? `, ${userName.split(" ")[0]}` : ""}`
                : active}
            </h1>
            <p>
              {period === "24"
                ? "Últimas 24h"
                : period === "72"
                  ? "Últimos 3 dias"
                  : period === "168"
                    ? "Últimos 7 dias"
                    : "Todas as vagas"}
              {sourcesCount !== null && sourcesCount > 0
                ? ` · ${sourcesCount} fonte${sourcesCount !== 1 ? "s" : ""} ativa${sourcesCount !== 1 ? "s" : ""}`
                : ""}
            </p>
          </div>
          <div className="header-actions">
            {!currentUser && (
              <a className="icon-btn" href="/login?return_to=/">
                Entrar
              </a>
            )}
            {isAdmin && (
              <a
                className="icon-btn"
                href={`/api/admin/report?period=${period}`}
              >
                ↓ Relatório Excel
              </a>
            )}
            {isAdmin && (
              <button className="primary" onClick={() => setImporting(true)}>
                ＋ Importar vagas
              </button>
            )}
          </div>
        </header>
        {message && <div className="notice">{message}</div>}
        <div className="radar-controls">
          <div className="radar-result-summary">
            <span><strong>{totalJobs ?? items.length}</strong> vagas no período selecionado</span>
            <span className="radar-source-breakdown">
              <strong>{totalLinkedIn ?? loadedLinkedIn}</strong> do LinkedIn
              <b> · </b>
              <strong>{totalOtherSources ?? loadedOtherSources}</strong> de
              outras fontes
            </span>
            {totalJobs !== null && totalJobs > items.length && (
              <em>Carregadas as {items.length} mais recentes para exibição</em>
            )}
          </div>
          <div
            className="radar-source-filter"
            role="group"
            aria-label="Filtrar por origem da vaga"
          >
            <button
              type="button"
              className={sourceFilter === "all" ? "active" : ""}
              onClick={() => setSourceFilter("all")}
            >
              Todas
            </button>
            <button
              type="button"
              className={sourceFilter === "linkedin" ? "active" : ""}
              onClick={() => setSourceFilter("linkedin")}
            >
              LinkedIn ({totalLinkedIn ?? loadedLinkedIn})
            </button>
            <button
              type="button"
              className={sourceFilter === "other" ? "active" : ""}
              onClick={() => setSourceFilter("other")}
            >
              Outras fontes ({totalOtherSources ?? loadedOtherSources})
            </button>
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
              aria-label="Período das vagas"
              onChange={(e) => setPeriod(e.target.value)}
              value={period ?? "24"}
            >
              <option value="24">Últimas 24h</option>
              <option value="72">Últimos 3 dias</option>
              <option value="168">Últimos 7 dias</option>
              <option value="all">Todas</option>
            </select>
            <label className="fit-filter">
              Aderência
              {fitFilter !== "profile" && fitFilter !== "all" && (
                <em className="filter-chip">≥{fitFilter}%</em>
              )}
              {fitFilter === "profile" && (
                <em className="filter-chip filter-chip--profile">≥{profileMinScore}% perfil</em>
              )}
              <select
                aria-label="Aderência ao seu perfil"
                value={fitFilter}
                onChange={(event) =>
                  setFitFilter(
                    event.target.value as "profile" | "all" | "70" | "80",
                  )
                }
              >
                <option value="profile">
                  Usar meu perfil (mínimo {profileMinScore}%+)
                </option>
                <option value="all">Todas as vagas</option>
                <option value="70">Boa aderência (70%+)</option>
                <option value="80">Alta aderência (80%+)</option>
              </select>
            </label>
          </div>
        </div>
        <div className="radar-advanced-filters" aria-label="Filtros de vagas">
          <div className="radar-filter-copy"><span>Filtros avançados</span><small>Combine tecnologia, nível e modalidade</small></div>
          <div className="radar-filter-fields">
            <label className="radar-filter-field">
              <span>
                Tecnologia
                {stackFilter && <em className="filter-chip">{stackFilter} ×</em>}
              </span>
              <select aria-label="Filtrar por tecnologia" value={stackFilter} onChange={(event) => setStackFilter(event.target.value)}>
                <option value="">Todas</option>
                {stackFilterOptions.map((option) => <option value={option} key={option}>{option}</option>)}
              </select>
            </label>
            <label className="radar-filter-field">
              <span>
                Senioridade
                {seniorityFilter && <em className="filter-chip">{seniorityFilter} ×</em>}
              </span>
              <select aria-label="Filtrar por senioridade" value={seniorityFilter} onChange={(event) => setSeniorityFilter(event.target.value)}>
                <option value="">Todas</option>
                {seniorityFilterOptions.map((option) => <option value={option} key={option}>{option}</option>)}
              </select>
            </label>
            <label className="radar-filter-field">
              <span>
                Modalidade
                {workModeFilter && <em className="filter-chip">{workModeFilter} ×</em>}
              </span>
              <select aria-label="Filtrar por modalidade" value={workModeFilter} onChange={(event) => setWorkModeFilter(event.target.value)}>
                <option value="">Todas</option>
                {["Remoto", "Híbrido", "Presencial"].map((option) => <option value={option} key={option}>{option}</option>)}
              </select>
            </label>
          </div>
          {(stackFilter || seniorityFilter || workModeFilter) && (
            <button
              type="button"
              className="clear-filters-btn"
              onClick={() => {
                setStackFilter("");
                setSeniorityFilter("");
                setWorkModeFilter("");
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
        <div className="workspace">
          <div className="job-list">
            <div className="list-head">
              <span>
                Exibindo{" "}
                <strong>{filtered.length}</strong> de{" "}
                <strong>{totalJobs ?? items.length}</strong> vagas
                {sourceFilter !== "all" &&
                  (sourceFilter === "linkedin"
                    ? " · só LinkedIn"
                    : " · só outras fontes")}
              </span>
              <span>ordenadas por aderência</span>
            </div>
            {filtered.map((j) => (
              <button
                key={j.id}
                className={`job-card ${selectedJob?.id === j.id ? "selected" : ""}`}
                onClick={() => setSelected(j)}
              >
                <div className="score">
                  {j.score}
                  <small>match</small>
                </div>
                <div className="job-main">
                  <small>{j.company.toUpperCase()}</small>
                  <h3>{j.title}</h3>
                  <p>
                    ⌖ {j.location} · {j.mode} · {j.age}
                  </p>
                  <div
                    className="tags job-stack"
                    aria-label="Tecnologias da vaga"
                  >
                    {j.stack.length ? (
                      j.stack.map((t) => <span key={t}>{t}</span>)
                    ) : (
                      <span className="stack-unavailable">
                        Stack não informada
                      </span>
                    )}
                  </div>
                </div>
                <span>♡</span>
              </button>
            ))}
            {hasMore && filtered.length > 0 && (
              <div className="load-more-row">
                <button
                  className="load-more-btn"
                  onClick={() => void loadMoreJobs()}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Carregando…" : `Carregar mais vagas (${items.length} de ${totalJobs ?? "?"} carregadas)`}
                </button>
              </div>
            )}
            {filtered.length === 0 && (
              <div className="radar-empty">
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
              </div>
            )}
          </div>
          {selectedJob ? (
            <aside className="detail">
              <div className="detail-heading">
                <div>
                  <small>{selectedJob.company.toUpperCase()}</small>
                  <h2>{selectedJob.title}</h2>
                  <p>
                    ⌖ {selectedJob.location} · {selectedJob.mode} ·{" "}
                    {selectedJob.age}
                  </p>
                </div>
                <span className="fit-inline">
                  <strong>{selectedJob.score}%</strong>
                  <small>match</small>
                </span>
              </div>
              <div className="match-reasons">
                <h4>COMO O SCORE FOI CALCULADO</h4>
                {selectedJob.reasons.map((reason) => (
                  <span key={reason}>{reason}</span>
                ))}
              </div>
              <div className="detail-actions radar-job-actions">
                <button onClick={() => save(selectedJob)}>♡ Salvar</button>
                <button
                  className="expand-description"
                  onClick={() => openJobDetail(selectedJob)}
                >
                  ⛶ Abrir em tela ampliada
                </button>
                <button
                  className="linkedin-action"
                  onClick={() =>
                    selectedJob.url && open(selectedJob.url, "_blank")
                  }
                >
                  {jobProviderLabel(selectedJob)}
                </button>
              </div>
              <section className="selected-description">
                <div>
                  <h4>DESCRIÇÃO DA VAGA</h4>
                  <span>Leitura organizada automaticamente</span>
                </div>
                <DescriptionContent
                  text={
                    selectedJob.description ||
                    "A descrição completa ainda não está disponível para esta vaga."
                  }
                />
              </section>
              {selectedJob.stack.length > 0 && (
                <section className="selected-stack">
                  <h4>TECNOLOGIAS IDENTIFICADAS</h4>
                  <div className="tags">
                    {selectedJob.stack.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </section>
              )}
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
                <strong>{detailJob.score}</strong>
                <small>FIT</small>
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
                onClick={() => detailJob.url && open(detailJob.url, "_blank")}
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
            <p>
              Inicie a coleta de uma empresa abaixo ou atualize todas as fontes
              automáticas.
            </p>
            <SourceList
              refreshKey={sourceVersion}
              onStart={(catalogId, name) => collectNow(catalogId, name)}
              onActivateAll={activateCatalog}
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
            <div className="source-actions">
              <button className="primary" onClick={() => void collectNow()}>
                Coletar todas
              </button>
            </div>
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
