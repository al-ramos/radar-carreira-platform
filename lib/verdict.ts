/**
 * verdict.ts — Avaliação estruturada de vagas contra o perfil canônico.
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

const ARCHITECT_RE = /\b(arquiteto|arquiteta|architect|architecture)\b/i;
const SENIOR_RE = /\b(sênior|senior|sr\.?|staff|principal|lead\s+dev|tech\s+lead)\b/i;
const PLENO_RE = /\b(pleno|pl\.?)\b/i;
const JUNIOR_RE = /\b(júnior|junior|jr\.?\s|estagiário|trainee)\b/i;

const CONSULTORIA_RE = /\b(consultoria|consulting|bodyshop|alocação|alocacao|outsourcing|terceirizado)\b/i;
const INTERMEDIARIO_RE = /\b(jobgether|betterleap|hired\.com|turing\.com|toptal|crossover|remoteok)\b/i;

/**
 * Variações que representam a mesma tecnologia no perfil e na vaga. A lista
 * é propositalmente curta: uma equivalência errada seria pior que pedir uma
 * confirmação ao candidato.
 */
import type { CareerRules } from "./profile-options";
import { isTechnicalSkillTag, skillsAreEquivalent, uniqueEquivalentSkills } from "./skill-taxonomy.ts";
import { priorityApprovalReason } from "./priority-approval.ts";

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

function matchesBuiltInStackException(fullText: string): string | null {
  const text = normalizeText(fullText);
  if (/\bvba\b/.test(text) && /\baccess\b/.test(text) && /\b(sql server|mssql)\b/.test(text)) {
    return "VBA + Access + SQL Server";
  }
  const qaDotNetSenior = /\b(qa|quality assurance|qualidade|tester|testes?)\b/.test(text)
    && /(?:\.net|\bdotnet\b|\bc#\b|\bcsharp\b)/.test(text)
    && /\b(senior|sr\.?|sênior)\b/.test(fullText.toLocaleLowerCase("pt-BR"));
  return qaDotNetSenior ? "QA .NET Sênior" : null;
}

/**
 * Regra de posicionamento do perfil: VBA e Visual Basic 6 são experiências
 * centrais para quem as mantém cadastradas. A vaga não deve cair para
 * "provável" apenas por declarar Pleno, contrato ou empresa de forma parcial.
 * Bloqueadores explícitos de idioma, senioridade vetada, atuação e geografia
 * continuam prevalecendo antes desta preferência.
 */
function matchesAlwaysApprovedLegacyStack(fullText: string, userSkills: string[]): string | null {
  const text = normalizeText(fullText);
  const mentionsVba = /\bvba\b/.test(text);
  const mentionsVb6 = /\b(?:visual\s+basic\s*6|vb\s*6)\b/.test(text);
  if (mentionsVba && userSkills.some(skill => skillsAreEquivalent(skill, "VBA"))) return "VBA";
  if (mentionsVb6 && userSkills.some(skill => skillsAreEquivalent(skill, "Visual Basic 6"))) return "Visual Basic 6";
  return null;
}

function requiredHybridDays(text: string): number | null {
  const match = normalizeText(text).match(/(?:hibrid\w*[^.\n]{0,60})?(\d)\s*(?:x|vez(?:es)?|dias?)\s*(?:por|na)?\s*semana/);
  return match ? Number(match[1]) : null;
}

export function languageAllowed(rules: CareerRules | undefined, language: string): boolean {
  if (!rules) return false;
  return rules.dailyCommunicationLanguages.some(item => normalizeText(item) === normalizeText(language));
}

function hasEquivalentSkill(requiredSkills: string[], profileSkills: string[]): boolean {
  return requiredSkills.some(required => profileSkills.some(profile => skillsAreEquivalent(required, profile)));
}

/**
 * Compara requisitos técnicos da vaga com as competências cadastradas. Ao
 * contrário do score geral, a lacuna é calculada na direção correta: o que a
 * vaga pede e não está no perfil, não o que existe no perfil mas não foi
 * citado na descrição.
 */
export function analyzeStackFit(jobStack: string[], userSkills: string[] = []): StackFit {
  const requiredSkills = uniqueEquivalentSkills(
    jobStack
      .map((skill) => skill.trim())
      .filter(skill => Boolean(skill) && isTechnicalSkillTag(skill)),
  );
  const profileSkills = userSkills;
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
  if (hasPj && !hasClt) return { status: preferred.length && !preferred.includes("PJ") ? "PJ (fora da preferência)" : "PJ aceita ✅", ok: preferred.length ? preferred.includes("PJ") : true };
  if (hasClt && !hasPj) return { status: preferred.length && !preferred.includes("CLT") ? "CLT (fora da preferência)" : "CLT aceita ✅", ok: preferred.length ? preferred.includes("CLT") : true };
  if (hasPj && hasClt) return preferred.includes("PJ") && preferred.includes("CLT")
    ? { status: "PJ ou CLT — ambos aceitos ✅", ok: true }
    : { status: "PJ ou CLT (a confirmar)", ok: null };
  if (rules?.acceptUnspecifiedContracts) return { status: "Não especificado — qualquer regime aceito ✅", ok: true };
  return { status: "Não especificado — a confirmar", ok: null };
}

const GRANDE_SP_ALIASES = [
  "sao paulo", "mogi das cruzes", "guarulhos", "osasco", "barueri", "carapicuiba", "cotia",
  "taboao da serra", "embu das artes", "santo andre", "sao bernardo do campo", "sao caetano do sul",
  "diadema", "maua", "ribeirao pires", "suzano", "poa", "itaquaquecetuba", "ferraz de vasconcelos", "aruja",
];

function locationMatchesRegion(location: string, region: string): boolean {
  const normalizedLocation = normalizeText(location);
  const normalizedRegion = normalizeText(region);
  if (normalizedLocation.includes(normalizedRegion) || normalizedRegion.includes(normalizedLocation)) return true;
  return ["grande sao paulo", "grande sp", "regiao metropolitana de sao paulo"].includes(normalizedRegion)
    && GRANDE_SP_ALIASES.some(alias => normalizedLocation.includes(alias));
}

/**
 * Algumas vagas impõem presença somente a residentes de uma região. Isso não
 * transforma a vaga em presencial para candidatos cujo local cadastrado está
 * fora dessa condição; a modalidade ainda precisa ser confirmada na fonte.
 */
function conditionalPresenceRegion(text: string): string | null {
  const normalized = normalizeText(text);
  const match = normalized.match(/(?:se\s+voce\s+(?:reside|mora)|para\s+quem\s+(?:reside|mora)|somente\s+para\s+(?:quem|candidatos?\s+que)\s+(?:reside|moram?))\s+(?:na?|em)\s+([^.;,\n]+)/i);
  if (!match) return null;
  return match[1].replace(/\s+(?:deve|devera|precisa|sera|tera|e\s+necessario)\b.*$/i, "").trim() || null;
}

function detectWorkMode(text: string, location: string, rules?: CareerRules): { status: string; ok: boolean | null } {
  const remote = REMOTE_RE.test(text);
  const hybrid = HYBRID_RE.test(text);
  const onsite = ONSITE_RE.test(text);
  if (remote) return { status: "Remoto ✅", ok: true };
  const acceptedLocations = [...(rules?.acceptedRegions ?? []), rules?.baseLocation ?? ""].filter(Boolean);
  const conditionalRegion = conditionalPresenceRegion(text);
  if ((hybrid || onsite) && conditionalRegion && acceptedLocations.length && !acceptedLocations.some(region => locationMatchesRegion(region, conditionalRegion))) {
    return { status: `Presença local condicionada a residir em ${conditionalRegion} — não se aplica ao local cadastrado; confirmar modalidade`, ok: null };
  }
  const locationAccepted = !acceptedLocations.length ? true : location.trim() ? acceptedLocations.some(region => locationMatchesRegion(location, region)) : null;
  const hybridDays = requiredHybridDays(text);
  if (hybrid) {
    if (locationAccepted === false) return { status: `Híbrido fora das regiões aceitas (${location})`, ok: false };
    if (hybridDays !== null && rules && hybridDays > rules.maxHybridDays) return { status: `Híbrido ${hybridDays}x/semana — limite do perfil: ${rules.maxHybridDays}x`, ok: false };
    if (locationAccepted === null) return { status: "Híbrido — localização a confirmar", ok: null };
    if (hybridDays === null && rules?.maxHybridDays === 5) return { status: "Híbrido em região aceita — qualquer frequência aceita ✅", ok: true };
    return { status: hybridDays === null ? "Híbrido em região aceita — dias a confirmar" : `Híbrido ${hybridDays}x/semana em região aceita ✅`, ok: hybridDays === null ? null : true };
  }
  if (onsite) return locationAccepted === false
    ? { status: `Presencial fora das regiões aceitas (${location})`, ok: false }
    : { status: locationAccepted === null ? "Presencial — localização a confirmar" : rules?.acceptOnsiteWithinAcceptedRegions ? "Presencial em região aceita ✅" : "Presencial em região aceita — fora da preferência", ok: rules?.acceptOnsiteWithinAcceptedRegions ? true : null };
  return { status: "Não especificado — a confirmar", ok: null };
}

function detectSeniority(title: string, declaredSeniority: string, rules?: CareerRules): { status: string; ok: boolean | null } {
  const seniorityText = `${title} ${declaredSeniority}`;
  const isArchitect = ARCHITECT_RE.test(seniorityText);
  const isSenior = SENIOR_RE.test(seniorityText);
  const isPleno = PLENO_RE.test(seniorityText);
  const isJunior = JUNIOR_RE.test(title);
  const blocked = includesConfiguredTerm(seniorityText, rules?.blockedSeniorities ?? []);
  if (blocked) return { status: `${blocked} — bloqueada pelo perfil`, ok: false };
  if (isArchitect) return { status: "Arquitetura — nível aceito ✅", ok: true };
  if (isSenior) return { status: "Sênior / equivalente ✅", ok: true };
  if (isPleno) return { status: "Pleno — abaixo do alvo principal", ok: null };
  if (isJunior) return { status: "Júnior — abaixo do esperado", ok: false };
  return { status: "Não especificado — provável Pleno/Sênior", ok: null };
}

function isOptionalRequirement(text: string, skill: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedSkill = normalizeText(skill).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const skillPattern = new RegExp(`\\b${normalizedSkill}\\b`, "i");
  const optionalMarker = /\b(diferenciais?|desejavel|desejaveis|nice to have|ser[aá] um diferencial|plus)\b/i;
  return normalizedText.split(/\n|[.;]/).some(part => optionalMarker.test(part) && skillPattern.test(part));
}

function detectStack(text: string, jobStack: string[], userSkills?: string[], rules?: CareerRules): { status: string; ok: boolean | null } {
  const { requiredSkills, matchingSkills, missingSkills } = analyzeStackFit(jobStack, userSkills);
  if (!requiredSkills.length) return { status: "Stack não identificada na vaga — confirmar", ok: null };
  if (!missingSkills.length) return { status: `${matchingSkills.join(", ")} ✅`, ok: true };
  const optionalMissing = rules?.acceptOptionalRequirements
    ? missingSkills.filter(skill => isOptionalRequirement(text, skill))
    : [];
  const requiredMissing = missingSkills.filter(skill => !optionalMissing.includes(skill));
  if (!requiredMissing.length) return {
    status: `${matchingSkills.join(", ")} ✅ · diferenciais aceitos: ${optionalMissing.join(", ")}`,
    ok: true,
  };
  if (!matchingSkills.length) return { status: `Impedimentos: ${missingSkills.join(", ")}`, ok: false };
  if (matchingSkills.length / requiredSkills.length < 0.34) return {
    status: `Baixa aderência: ${matchingSkills.join(", ")} — faltam: ${requiredMissing.join(", ")}`,
    ok: false,
  };
  return {
    status: `${matchingSkills.join(", ")} — faltam: ${requiredMissing.join(", ")}${optionalMissing.length ? ` · diferenciais aceitos: ${optionalMissing.join(", ")}` : ""}`,
    ok: null,
  };
}

function detectLanguageReq(text: string, rules?: CareerRules): { status: string; ok: boolean | null } {
  const engBlocker = testAny(text, ENGLISH_BLOCKER_RE);
  const spaBlocker = testAny(text, SPANISH_BLOCKER_RE);
  const engMentioned = /inglês|english/i.test(text);
  const spaMentioned = /espanhol|spanish|español/i.test(text);
  const spanishDescription = countMatches(text, LATAM_SPANISH_RE) >= 2;
  if (engBlocker) return languageAllowed(rules, "Inglês") ? { status: "Inglês avançado exigido — aceito pelo perfil ✅", ok: true } : { status: "Inglês avançado exigido ❌", ok: false };
  if (spaBlocker) return languageAllowed(rules, "Espanhol") ? { status: "Espanhol avançado exigido — aceito pelo perfil ✅", ok: true } : { status: "Espanhol avançado exigido ❌", ok: false };
  if (engMentioned && !engBlocker) return { status: "Inglês mencionado mas não exigido", ok: null };
  if (spaMentioned && !spaBlocker) return { status: "Espanhol mencionado mas não exigido", ok: null };
  if (spanishDescription) return { status: "Descrição em espanhol — confirmar idioma da comunicação diária", ok: null };
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
}, userSkills: string[] = [], rules?: CareerRules): VerdictResult {
  const fullText = `${job.title} ${job.description} ${job.workMode ?? ""} ${job.location ?? ""}`;
  const priorityTechnology = priorityApprovalReason(`${fullText} ${job.stack.join(" ")}`);
  const lc = fullText.toLowerCase();
  const stackText = `${fullText} ${job.stack.join(" ")}`;
  const stackFit = analyzeStackFit(job.stack, userSkills);
  const alwaysApprovedLegacyStack = matchesAlwaysApprovedLegacyStack(stackText, userSkills);
  const configuredException = matchesStackException(stackText, rules?.stackExceptions ?? []);
  const stackException = matchesBuiltInStackException(stackText) ?? configuredException;
  const coreStack = rules?.coreStack ?? [];
  const coreMatch = coreStack.length ? hasEquivalentSkill(stackFit.requiredSkills, coreStack) : stackFit.matchingSkills.length > 0;
  const stackGate = alwaysApprovedLegacyStack
    ? { status: stackException ? `Exceção automática: ${stackException} ✅ · Preferência do perfil: ${alwaysApprovedLegacyStack}` : `Preferência do perfil: ${alwaysApprovedLegacyStack} ✅`, ok: true as const }
    : stackException
    ? { status: `Exceção automática: ${stackException} ✅`, ok: true as const }
    : !stackFit.requiredSkills.length
      ? { status: "Stack não identificada — continuar com ressalva", ok: null }
      : coreMatch
        ? { status: coreStack.length ? `Ecossistema principal identificado: ${stackFit.requiredSkills.filter(skill => coreStack.some(core => skillsAreEquivalent(skill, core))).join(", ")} ✅` : "Stack compatível com o perfil ✅", ok: true as const }
        : { status: coreStack.length ? `Stack fora do foco principal (${coreStack.join(" / ")}) — revisar no link da vaga` : "Stack não confirmada no perfil — revisar no link da vaga", ok: null as const };

  const structuralRows: VerdictRow[] = priorityTechnology
    ? [{ criterion: "Prioridade", status: `Tecnologia prioritária identificada: ${priorityTechnology} (requisito ou diferencial)`, ok: true }]
    : [{ criterion: "Fase 1 · Stack", ...stackGate }];
  const blocked = (blocker: string): VerdictResult => ({ emoji: "❌", label: "Bloqueador estrutural", blocker, rows: structuralRows });

  // Fase 1: os bloqueadores são avaliados e interrompem a triagem nesta ordem.
  // Stack fora do foco é uma informação para revisão, nunca um bloqueio de triagem.

  const languageRow = detectLanguageReq(fullText, rules);
  structuralRows.push({ criterion: "Fase 1 · Idioma", ...languageRow });
  if (languageRow.ok === false) {
    return blocked(testAny(fullText, ENGLISH_BLOCKER_RE) ? "Inglês avançado exigido" : "Espanhol avançado exigido");
  }

  const seniorRow = detectSeniority(job.title, job.seniority ?? "", rules);
  structuralRows.push({ criterion: "Fase 1 · Senioridade", ...seniorRow });
  if (seniorRow.ok === false) return blocked(`Senioridade incompatível: ${seniorRow.status}`);

  const blockedWorkType = includesConfiguredTerm(fullText, rules?.blockedWorkTypes ?? []);
  const workTypeRow = blockedWorkType
    ? { status: `${blockedWorkType} — bloqueado pelo perfil`, ok: false as const }
    : { status: "Sem atuação bloqueada identificada ✅", ok: true as const };
  structuralRows.push({ criterion: "Fase 1 · Atuação", ...workTypeRow });
  if (blockedWorkType) return blocked(`Tipo de atuação bloqueado: ${blockedWorkType}`);

  const workRow = detectWorkMode(lc, job.location ?? "", rules);
  structuralRows.push({ criterion: "Fase 1 · Geografia", ...workRow });
  const locationBlocked = workRow.ok === false && /fora das regioes aceitas|limite do perfil/i.test(normalizeText(workRow.status));
  if (locationBlocked) return blocked(workRow.status);

  // Tecnologia prioritária é somente evidência técnica. As fases 2 a 4 são
  // obrigatórias para aprovar: ela não pode substituir dados de perfil nem
  // transformar uma vaga incompleta em ✅.
  const contractRow = detectContratacao(lc, rules);
  const technicalFitRow = stackException
    ? { status: `Exceção técnica aceita: ${stackException} ✅`, ok: true as const }
    : detectStack(fullText, job.stack, userSkills, rules);
  const companyRow = detectCompanyType(lc);
  const rows: VerdictRow[] = [
    ...structuralRows,
    { criterion: "Fase 2 · Contratação", ...contractRow },
    { criterion: "Fase 3 · Fit técnico", ...technicalFitRow },
    { criterion: "Fase 4 · Empresa", ...companyRow },
  ];

  if (alwaysApprovedLegacyStack) {
    rows.push({ criterion: "Preferência do perfil", status: `${alwaysApprovedLegacyStack} — aderência prioritária 100% ✅`, ok: true });
    return { emoji: "✅", label: "Bate", rows };
  }

  const decisionRows = [languageRow, workRow, contractRow, seniorRow, technicalFitRow, companyRow];
  const falseCount = decisionRows.filter(row => row.ok === false).length;
  const technicalCoverage = stackFit.requiredSkills.length
    ? stackFit.matchingSkills.length / stackFit.requiredSkills.length
    : 0;
  // Uma vaga Full Stack costuma listar tecnologias complementares que podem
  // ser aprendidas no contexto do trabalho. Quando o ecossistema central do
  // perfil está presente, pelo menos 40% da stack exigida já é dominada e os
  // demais critérios passaram, essas lacunas continuam explicadas na tela,
  // mas não rebaixam sozinhas uma vaga de ✅ para 🟡.
  const complementaryTechnicalReservation = technicalFitRow.ok === null
    && stackGate.ok === true
    && technicalCoverage >= 0.4;
  const reservationCount = decisionRows.filter(row => row.ok === null && !(row === technicalFitRow && complementaryTechnicalReservation)).length;
  if (technicalFitRow.ok === false || falseCount >= 2) return { emoji: "🔴", label: "Não bate", rows };
  if (falseCount === 0 && reservationCount === 0) return { emoji: "✅", label: "Bate", rows };
  return { emoji: "🟡", label: "Provável com ressalvas", rows };
}
