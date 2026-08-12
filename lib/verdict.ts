/**
 * verdict.ts — Avaliação estruturada de vagas contra o perfil do candidato .NET
 * Implementa as regras do prompt de análise de vagas sem depender de API externa.
 */

export type VerdictEmoji = "✅" | "🟡" | "🔴" | "❌";

export interface VerdictRow {
  criterion: string;
  status: string;
  /** true = ok, false = problema, null = neutro/desconhecido */
  ok: boolean | null;
}

export interface VerdictResult {
  emoji: VerdictEmoji;
  label: string;
  /** Preenchido quando emoji === "❌" */
  blocker?: string;
  rows: VerdictRow[];
}

export interface StackFit {
  /** Tecnologias detectadas nos requisitos da vaga. */
  requiredSkills: string[];
  /** Requisitos da vaga para os quais há evidência no perfil. */
  matchingSkills: string[];
  /** Requisitos da vaga que não constam do perfil e merecem confirmação. */
  missingSkills: string[];
}

// ── Padrões de bloqueadores estruturais ──────────────────────────────────────

const ENGLISH_BLOCKER_RE = [
  /inglês\s*(avançado|fluente|conversacional|nativo|obrigatório)/i,
  /english\s*(advanced|fluent|conversational|native|required|mandatory|proficiency)/i,
  /fluente\s*em\s*inglês/i,
  /advanced\s*english/i,
  /english\s*proficiency\s*required/i,
];

const SPANISH_BLOCKER_RE = [
  /espanhol\s*(avançado|fluente|conversacional|nativo|obrigatório)/i,
  /spanish\s*(advanced|fluent|conversational|native|required|mandatory)/i,
  /fluente\s*em\s*espanhol/i,
  /hablar\s*español/i,
  /español\s*(avanzado|fluido|requerido)/i,
];

/** Vaga claramente em espanhol para mercado LATAM */
const LATAM_SPANISH_RE = [
  /desarrollador/i,
  /programador/i,
  /ingeniero\s+de\s+software/i,
  /desarrolladora/i,
  /postulación/i,
  /requisitos\s+del\s+puesto/i,
];

// ── Padrões de critérios de preferência ─────────────────────────────────────

const REMOTE_RE = /\b(remoto|remote|home\s*office|100%\s*remoto)\b/i;
const HYBRID_RE = /\b(híbrido|hibrido|hybrid|flexível|flexivel)\b/i;
const ONSITE_RE = /\b(presencial|on-?site|escritório)\b/i;

const PJ_RE = /\b(pj|pessoa\s+jurídica|cnpj|nota\s+fiscal)\b/i;
const CLT_RE = /\b(clt|carteira\s+assinada|regime\s+clt|contrato\s+clt)\b/i;

const SUSTENTACAO_RE = /\b(sustentação|sustentacao|suporte\s+técnico|analista\s+de\s+suporte|n[123]\s+suporte|helpdesk|service\s*desk)\b/i;

const SENIOR_RE = /\b(sênior|senior|sr\.?\s|pleno|pl\.?\s|staff|principal|lead\s+dev|tech\s+lead|architect)\b/i;
const JUNIOR_RE = /\b(júnior|junior|jr\.?\s|estagiário|trainee)\b/i;

const CONSULTORIA_RE = /\b(consultoria|consulting|bodyshop|alocação|alocacao|outsourcing|terceirizado)\b/i;
const INTERMEDIARIO_RE = /\b(jobgether|betterleap|hired\.com|turing\.com|toptal|crossover|remoteok)\b/i;

/** Stack principal do candidato (C#/.NET/AWS etc.) */
const CANDIDATE_STACK = [
  "c#", ".net", "asp.net", "dotnet", "net core", ".net core", ".net 8", ".net 6",
  "aws", "sql server", "mssql", "rabbitmq", "masstransit", "mediatr", "polly",
  "react", "typescript", "terraform", "github actions", "docker", "kubernetes",
  "entity framework", "ef core", "dapper", "azure", "azure devops",
];

/**
 * Variações que representam a mesma tecnologia no perfil e na vaga. A lista
 * é propositalmente curta: uma equivalência errada seria pior que pedir uma
 * confirmação ao candidato.
 */
import type { CareerRules } from "./profile-options";
const STACK_EQUIVALENCE_GROUPS = [
  ["gcp", "google cloud", "google cloud platform"],
  ["aws", "amazon web services"],
  ["azure", "microsoft azure"],
  ["c#", "csharp", ".net", "dotnet", "net core", ".net core", "asp.net", "asp net"],
  ["sql", "sql server", "mssql"],
  ["postgres", "postgresql"],
  ["node", "node.js", "nodejs"],
  ["react", "react.js", "reactjs"],
  ["vue", "vue.js", "vuejs"],
  ["next", "next.js", "nextjs"],
  ["kubernetes", "k8s"],
] as const;

// ── Funções auxiliares ───────────────────────────────────────────────────────

function testAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((r) => r.test(text));
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((r) => r.test(text)).length;
}

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function includesConfiguredTerm(text: string, terms: string[]): string | null {
  const normalizedText = normalizeText(text);
  return terms.find(term => normalizedText.includes(normalizeText(term))) ?? null;
}

function matchesStackException(fullText: string, exceptions: string[]): string | null {
  const normalizedText = normalizeText(fullText);
  return exceptions.find(exception => {
    const parts = normalizeText(exception).split(/\s*(?:\+|,|\/|\be\b)\s*/).map(part => part.trim()).filter(part => part.length > 1);
    return parts.length > 0 && parts.every(part => normalizedText.includes(part));
  }) ?? null;
}

function requiredHybridDays(text: string): number | null {
  const match = normalizeText(text).match(/(?:hibrid\w*[^.\n]{0,60})?(\d)\s*(?:x|vez(?:es)?|dias?)\s*(?:por|na)?\s*semana/);
  return match ? Number(match[1]) : null;
}

function languageAllowed(rules: CareerRules | undefined, language: string): boolean {
  if (!rules) return false;
  return rules.dailyCommunicationLanguages.some(item => normalizeText(item) === normalizeText(language));
}

function normalizeSkill(skill: string): string {
  return skill.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

function skillsAreEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizeSkill(left);
  const normalizedRight = normalizeSkill(right);
  if (normalizedLeft === normalizedRight) return true;
  return STACK_EQUIVALENCE_GROUPS.some((group) =>
    group.includes(normalizedLeft as never) && group.includes(normalizedRight as never),
  );
}

/**
 * Compara requisitos técnicos da vaga com as competências cadastradas. Ao
 * contrário do score geral, a lacuna é calculada na direção correta: o que a
 * vaga pede e não está no perfil, não o que existe no perfil mas não foi
 * citado na descrição.
 */
export function analyzeStackFit(jobStack: string[], userSkills?: string[]): StackFit {
  const requiredSkills = [...new Map(
    jobStack
      .map((skill) => skill.trim())
      .filter(Boolean)
      .map((skill) => [normalizeSkill(skill), skill]),
  ).values()];
  const profileSkills = userSkills?.length ? userSkills : CANDIDATE_STACK;
  const matchingSkills = requiredSkills.filter((required) =>
    profileSkills.some((profileSkill) => skillsAreEquivalent(required, profileSkill)),
  );
  return {
    requiredSkills,
    matchingSkills,
    missingSkills: requiredSkills.filter((required) => !matchingSkills.includes(required)),
  };
}

function detectContratacao(text: string, rules?: CareerRules): { status: string; ok: boolean | null } {
  const hasPj = PJ_RE.test(text);
  const hasClt = CLT_RE.test(text);
  const preferred = rules?.preferredContracts ?? [];
  if (hasPj && !hasClt) return { status: preferred.length && !preferred.includes("PJ") ? "PJ (fora da preferência)" : "PJ ✅", ok: preferred.length ? preferred.includes("PJ") : true };
  if (hasClt && !hasPj) return { status: preferred.length && !preferred.includes("CLT") ? "CLT (fora da preferência)" : "CLT ✅", ok: preferred.length ? preferred.includes("CLT") : true };
  if (hasPj && hasClt) return { status: "PJ ou CLT (a confirmar)", ok: null };
  return { status: "Não especificado — a confirmar", ok: null };
}

function detectWorkMode(text: string, location: string, rules?: CareerRules): { status: string; ok: boolean | null } {
  const remote = REMOTE_RE.test(text);
  const hybrid = HYBRID_RE.test(text);
  const onsite = ONSITE_RE.test(text);
  if (remote) return { status: "Remoto ✅", ok: true };
  const acceptedLocations = [...(rules?.acceptedRegions ?? []), rules?.baseLocation ?? ""].filter(Boolean);
  const locationAccepted = !acceptedLocations.length || acceptedLocations.some(region => normalizeText(location).includes(normalizeText(region)) || normalizeText(region).includes(normalizeText(location)));
  const hybridDays = requiredHybridDays(text);
  if (hybrid) {
    if (!locationAccepted) return { status: `Híbrido fora das regiões aceitas (${location || "local não informado"})`, ok: false };
    if (hybridDays !== null && rules && hybridDays > rules.maxHybridDays) return { status: `Híbrido ${hybridDays}x/semana — limite do perfil: ${rules.maxHybridDays}x`, ok: false };
    return { status: hybridDays === null ? "Híbrido — dias presenciais a confirmar" : `Híbrido ${hybridDays}x/semana ✅`, ok: hybridDays === null ? null : true };
  }
  if (onsite) return { status: locationAccepted ? "Presencial em região aceita" : `Presencial fora das regiões aceitas (${location || "local não informado"})`, ok: locationAccepted ? null : false };
  return { status: "Não especificado — a confirmar", ok: null };
}

function detectSeniority(title: string, text: string, rules?: CareerRules): { status: string; ok: boolean | null } {
  const isSustentacao = SUSTENTACAO_RE.test(title + " " + text.slice(0, 300));
  const isSenior = SENIOR_RE.test(title);
  const isJunior = JUNIOR_RE.test(title);
  const blocked = includesConfiguredTerm(`${title} ${text.slice(0, 240)}`, rules?.blockedSeniorities ?? []);
  if (blocked) return { status: `${blocked} — bloqueada pelo perfil`, ok: false };
  if (isSustentacao) return { status: "Sustentação/Suporte — rebaixa veredito", ok: false };
  if (isSenior) return { status: "Sênior / equivalente ✅", ok: true };
  if (isJunior) return { status: "Júnior — abaixo do esperado", ok: false };
  return { status: "Não especificado — provável Pleno/Sênior", ok: null };
}

function detectStack(text: string, jobStack: string[], userSkills?: string[]): { status: string; ok: boolean | null } {
  void text; // A stack já foi inferida a partir da descrição antes desta análise.
  const { requiredSkills, matchingSkills, missingSkills } = analyzeStackFit(jobStack, userSkills);
  if (!requiredSkills.length) return { status: "Stack não identificada na vaga — confirmar", ok: null };
  if (!missingSkills.length) return { status: `${matchingSkills.join(", ")} ✅`, ok: true };
  if (!matchingSkills.length) return { status: `Impedimentos: ${missingSkills.join(", ")}`, ok: false };
  return {
    status: `${matchingSkills.join(", ")} — faltam: ${missingSkills.join(", ")}`,
    ok: null,
  };
}

function detectLanguageReq(text: string, rules?: CareerRules): { status: string; ok: boolean | null } {
  const engBlocker = testAny(text, ENGLISH_BLOCKER_RE);
  const spaBlocker = testAny(text, SPANISH_BLOCKER_RE);
  const engMentioned = /inglês|english/i.test(text);
  const spaMentioned = /espanhol|spanish|español/i.test(text);
  if (engBlocker) return languageAllowed(rules, "Inglês") ? { status: "Inglês avançado exigido — aceito pelo perfil ✅", ok: true } : { status: "Inglês avançado exigido ❌", ok: false };
  if (spaBlocker) return languageAllowed(rules, "Espanhol") ? { status: "Espanhol avançado exigido — aceito pelo perfil ✅", ok: true } : { status: "Espanhol avançado exigido ❌", ok: false };
  if (engMentioned && !engBlocker) return { status: "Inglês mencionado mas não exigido", ok: null };
  if (spaMentioned && !spaBlocker) return { status: "Espanhol mencionado mas não exigido", ok: null };
  return { status: "Não exigido ✅", ok: true };
}

function detectCompanyType(text: string): { status: string; ok: boolean | null } {
  const isIntermediario = testAny(text, [INTERMEDIARIO_RE]);
  const isConsultoria = CONSULTORIA_RE.test(text);
  if (isIntermediario) return { status: "Intermediário com IA ⚠️ — processo menos transparente", ok: null };
  if (isConsultoria) return { status: "Consultoria / bodyshop — cliente final desconhecido", ok: null };
  return { status: "Produto ou empresa direta ✅", ok: true };
}

// ── Função principal ─────────────────────────────────────────────────────────

export function computeVerdict(job: {
  title: string;
  description: string;
  stack: string[];
  seniority?: string | null;
  workMode?: string | null;
  location?: string | null;
}, userSkills?: string[], rules?: CareerRules): VerdictResult {
  const fullText = `${job.title} ${job.description} ${job.workMode ?? ""} ${job.location ?? ""}`;
  const lc = fullText.toLowerCase();

  // 1. Bloqueadores estruturais
  const engBlocker = testAny(fullText, ENGLISH_BLOCKER_RE) && !languageAllowed(rules, "Inglês");
  const spaBlocker = testAny(fullText, SPANISH_BLOCKER_RE) && !languageAllowed(rules, "Espanhol");
  const latamSpanish = countMatches(fullText, LATAM_SPANISH_RE) >= 2 && !languageAllowed(rules, "Espanhol");
  const blockedSeniority = includesConfiguredTerm(`${job.title} ${job.seniority ?? ""}`, rules?.blockedSeniorities ?? []);
  const blockedWorkType = includesConfiguredTerm(fullText, rules?.blockedWorkTypes ?? []);
  const stackException = matchesStackException(`${fullText} ${job.stack.join(" ")}`, rules?.stackExceptions ?? []);
  const stackFit = analyzeStackFit(job.stack, userSkills);
  const stackBlocked = stackFit.requiredSkills.length > 0 && stackFit.matchingSkills.length === 0 && !stackException;
  const workEvaluation = detectWorkMode(lc, job.location ?? "", rules);
  const locationBlocked = workEvaluation.ok === false && /fora das regioes aceitas|limite do perfil/i.test(normalizeText(workEvaluation.status));

  if (engBlocker || spaBlocker || latamSpanish || blockedSeniority || blockedWorkType || stackBlocked || locationBlocked) {
    const blocker = engBlocker
      ? "Inglês avançado exigido"
      : spaBlocker
        ? "Espanhol avançado exigido"
        : latamSpanish
          ? "Vaga em espanhol (LATAM)"
          : blockedSeniority
            ? `Senioridade bloqueada: ${blockedSeniority}`
            : blockedWorkType
              ? `Tipo de atuação bloqueado: ${blockedWorkType}`
              : stackBlocked
                ? "Stack incompatível com o perfil"
                : workEvaluation.status;

    const langRow = detectLanguageReq(fullText, rules);
    const stackRow = detectStack(lc, job.stack, userSkills);
    const workRow = workEvaluation;
    const contrRow = detectContratacao(lc, rules);
    const seniorRow = detectSeniority(job.title, lc, rules);
    const companyRow = detectCompanyType(lc);

    return {
      emoji: "❌",
      label: "Bloqueador estrutural",
      blocker,
      rows: [
        { criterion: "Stack", ...stackRow },
        { criterion: "Trabalho", ...workRow },
        { criterion: "Contratação", ...contrRow },
        { criterion: "Senioridade", ...seniorRow },
        { criterion: "Inglês / Espanhol", ...langRow },
        { criterion: "Empresa (tipo)", ...companyRow },
      ],
    };
  }

  // 2. Avalia critérios normais
  const stackRow = detectStack(lc, job.stack, userSkills);
  const workRow = workEvaluation;
  const contrRow = detectContratacao(lc, rules);
  const seniorRow = detectSeniority(job.title, lc, rules);
  const langRow = detectLanguageReq(fullText, rules);
  const companyRow = detectCompanyType(lc);

  const rows: VerdictRow[] = [
    { criterion: "Stack", ...(stackException ? { status: `Exceção do perfil: ${stackException} ✅`, ok: true } : stackRow) },
    { criterion: "Trabalho", ...workRow },
    { criterion: "Contratação", ...contrRow },
    { criterion: "Senioridade", ...seniorRow },
    { criterion: "Inglês / Espanhol", ...langRow },
    { criterion: "Empresa (tipo)", ...companyRow },
  ];

  // 3. Calcula veredito
  const falseCount = rows.filter((r) => r.ok === false).length;
  const okCount = rows.filter((r) => r.ok === true).length;
  const isSustentacao = SUSTENTACAO_RE.test(job.title);

  let emoji: VerdictEmoji;
  let label: string;

  if (falseCount === 0 && okCount >= 3) {
    emoji = "✅";
    label = "Bate";
  } else if (falseCount <= 1 && !isSustentacao) {
    emoji = "🟡";
    label = "Provável";
  } else if (falseCount >= 3 || isSustentacao) {
    emoji = "🔴";
    label = "Não bate";
  } else {
    emoji = "🟡";
    label = "Provável — avaliar";
  }

  return { emoji, label, rows };
}
