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

// ── Funções auxiliares ───────────────────────────────────────────────────────

function testAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((r) => r.test(text));
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter((r) => r.test(text)).length;
}

function detectContratacao(text: string): { status: string; ok: boolean | null } {
  const hasPj = PJ_RE.test(text);
  const hasClt = CLT_RE.test(text);
  if (hasPj && !hasClt) return { status: "PJ ✅", ok: true };
  if (hasClt && !hasPj) return { status: "CLT (menos preferido)", ok: false };
  if (hasPj && hasClt) return { status: "PJ ou CLT (a confirmar)", ok: null };
  return { status: "Não especificado — a confirmar", ok: null };
}

function detectWorkMode(text: string): { status: string; ok: boolean | null } {
  const remote = REMOTE_RE.test(text);
  const hybrid = HYBRID_RE.test(text);
  const onsite = ONSITE_RE.test(text);
  if (remote) return { status: "Remoto ✅", ok: true };
  if (hybrid) return { status: "Híbrido — verificar carga presencial", ok: null };
  if (onsite) return { status: "Presencial ⚠️", ok: false };
  return { status: "Não especificado — a confirmar", ok: null };
}

function detectSeniority(title: string, text: string): { status: string; ok: boolean | null } {
  const isSustentacao = SUSTENTACAO_RE.test(title + " " + text.slice(0, 300));
  const isSenior = SENIOR_RE.test(title);
  const isJunior = JUNIOR_RE.test(title);
  if (isSustentacao) return { status: "Sustentação/Suporte — rebaixa veredito", ok: false };
  if (isSenior) return { status: "Sênior / equivalente ✅", ok: true };
  if (isJunior) return { status: "Júnior — abaixo do esperado", ok: false };
  return { status: "Não especificado — provável Pleno/Sênior", ok: null };
}

function detectStack(text: string, jobStack: string[]): { status: string; ok: boolean | null } {
  const combined = `${text} ${jobStack.join(" ")}`.toLowerCase();
  const hits = CANDIDATE_STACK.filter((s) => combined.includes(s));
  if (hits.length >= 3) return { status: `${hits.slice(0, 4).map((s) => s.toUpperCase().replace(".", "")).join(", ")} ✅`, ok: true };
  if (hits.length >= 1) return { status: `${hits.map((s) => s.toUpperCase().replace(".", "")).join(", ")} — fit parcial`, ok: null };
  return { status: "Sem aderência clara ao stack .NET", ok: false };
}

function detectLanguageReq(text: string): { status: string; ok: boolean | null } {
  const engBlocker = testAny(text, ENGLISH_BLOCKER_RE);
  const spaBlocker = testAny(text, SPANISH_BLOCKER_RE);
  const engMentioned = /inglês|english/i.test(text);
  const spaMentioned = /espanhol|spanish|español/i.test(text);
  if (engBlocker) return { status: "Inglês avançado exigido ❌", ok: false };
  if (spaBlocker) return { status: "Espanhol avançado exigido ❌", ok: false };
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
}): VerdictResult {
  const fullText = `${job.title} ${job.description}`;
  const lc = fullText.toLowerCase();

  // 1. Bloqueadores estruturais
  const engBlocker = testAny(fullText, ENGLISH_BLOCKER_RE);
  const spaBlocker = testAny(fullText, SPANISH_BLOCKER_RE);
  const latamSpanish = countMatches(fullText, LATAM_SPANISH_RE) >= 2;

  if (engBlocker || spaBlocker || latamSpanish) {
    const blocker = engBlocker
      ? "Inglês avançado exigido"
      : spaBlocker
        ? "Espanhol avançado exigido"
        : "Vaga em espanhol (LATAM)";

    const langRow = detectLanguageReq(fullText);
    const stackRow = detectStack(lc, job.stack);
    const workRow = detectWorkMode(lc);
    const contrRow = detectContratacao(lc);
    const seniorRow = detectSeniority(job.title, lc);
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
  const stackRow = detectStack(lc, job.stack);
  const workRow = detectWorkMode(lc);
  const contrRow = detectContratacao(lc);
  const seniorRow = detectSeniority(job.title, lc);
  const langRow = detectLanguageReq(fullText);
  const companyRow = detectCompanyType(lc);

  const rows: VerdictRow[] = [
    { criterion: "Stack", ...stackRow },
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
