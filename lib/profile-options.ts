export const SENIORITY_OPTIONS = [
  "Estágio", "Trainee", "Júnior", "Pleno", "Sênior", "Especialista",
  "Tech Lead", "Coordenador", "Gerente", "Diretor",
];

export const WORK_MODE_OPTIONS = ["Remoto", "Híbrido", "Presencial"];

export const CONTRACT_OPTIONS = ["PJ", "CLT"];
export const DAILY_LANGUAGE_OPTIONS = ["Português", "Inglês", "Espanhol"];
export const REGION_OPTIONS = ["Grande São Paulo", "São Paulo - Capital", "Alto Tietê", "Interior de São Paulo", "Brasil"];
export const BLOCKED_WORK_TYPE_OPTIONS = ["Sustentação", "Suporte", "Help desk", "Atendimento", "Vendas"];

export const SKILL_GROUPS = [
  { label: "Front-end e mobile", options: ["HTML", "CSS", "JavaScript", "TypeScript", "React", "Next.js", "Angular", "Vue.js", "Svelte", "React Native", "Flutter", "Dart", "Android", "iOS", "Swift", "Kotlin"] },
  { label: "Back-end e linguagens", options: ["Node.js", "Deno", "Bun", "Java", "Spring", "Quarkus", "C#", ".NET", "ASP.NET", "Python", "Django", "FastAPI", "Flask", "PHP", "Laravel", "Symfony", "Ruby", "Rails", "Go", "Rust", "C++", "Scala", "Elixir"] },
  { label: "Dados, bancos e mensageria", options: ["SQL", "SQL Server", "PostgreSQL", "MySQL", "MariaDB", "Oracle", "SQLite", "MongoDB", "DynamoDB", "Cassandra", "Redis", "Elasticsearch", "OpenSearch", "Neo4j", "Kafka", "RabbitMQ", "ActiveMQ", "Spark", "Airflow", "dbt", "Databricks", "Snowflake", "BigQuery", "Redshift"] },
  { label: "Cloud e DevOps", options: ["AWS", "Azure", "GCP", "OCI", "Cloudflare", "Vercel", "Firebase", "Supabase", "Docker", "Kubernetes", "Helm", "Terraform", "Pulumi", "Ansible", "Linux", "Nginx", "Apache", "Jenkins", "GitHub Actions", "GitLab CI", "Azure DevOps", "Argo CD", "Git"] },
  { label: "APIs, qualidade e arquitetura", options: ["REST", "GraphQL", "gRPC", "SOAP", "OpenAPI", "Microservices", "Event-driven", "Jest", "Vitest", "Cypress", "Playwright", "Selenium", "JUnit", "Pytest", "TDD", "DDD"] },
  { label: "IA, analytics e BI", options: ["R", "Pandas", "NumPy", "scikit-learn", "TensorFlow", "PyTorch", "LLM", "OpenAI", "LangChain", "MLOps", "Power BI", "Tableau", "Looker", "Qlik", "ETL", "Data Lake"] },
  { label: "Segurança", options: ["Cybersecurity", "AppSec", "DevSecOps", "IAM", "SIEM", "SOC", "SAST", "DAST", "OWASP", "Zero Trust", "Splunk", "CrowdStrike", "Palo Alto"] },
  { label: "Sistemas corporativos", options: ["SAP", "Salesforce", "ServiceNow", "Dynamics 365", "TOTVS", "ERP", "CRM"] },
];

export const SKILL_OPTIONS = SKILL_GROUPS.flatMap(group => group.options);

export const AREA_OPTIONS = [
  "Desenvolvimento Front-end", "Desenvolvimento Back-end", "Full Stack", "Mobile",
  "Arquitetura de Software", "Cloud", "DevOps", "DevSecOps", "Cybersecurity",
  "Security Operations", "Infraestrutura", "Engenharia de Dados", "Dados / BI",
  "Inteligência Artificial", "Qualidade / QA", "Produto", "ERP / SAP", "Salesforce",
];

export const AVOID_TERM_OPTIONS = [
  // Tipos de vaga indesejados
  "Estágio", "Trainee", "Júnior", "Presencial", "Vendas", "Comercial",
  "Suporte", "Atendimento", "Freelancer", "Temporário",
  // Inglês — papéis não-técnicos
  "Sales", "Support", "Customer Success", "Account Executive", "SDR", "BDR", "Internship", "Intern",
  // Espanhol — filtra vagas fora do Brasil
  "Desarrollador", "Programador", "Ingeniero", "Desarrolladora",
];

export type ProfileChoices = {
  seniority: string[];
  preferredMode: string[];
  masteredSkills: string[];
  desiredAreas: string[];
  avoidTerms: string[];
  minScore: number;
  careerRules: CareerRules;
};

export type CareerRules = {
  professionalName: string;
  professionalTitle: string;
  professionalSummary: string;
  baseLocation: string;
  acceptedRegions: string[];
  maxHybridDays: number;
  preferredContracts: string[];
  dailyCommunicationLanguages: string[];
  blockedSeniorities: string[];
  blockedWorkTypes: string[];
  coreStack: string[];
  stackExceptions: string[];
  anchorProject: string;
  discloseGapsInEmail: boolean;
  aiMonthlyTokenLimit: number;
};

export const emptyCareerRules = (): CareerRules => ({
  professionalName: "",
  professionalTitle: "",
  professionalSummary: "",
  baseLocation: "",
  acceptedRegions: [],
  maxHybridDays: 2,
  preferredContracts: [],
  dailyCommunicationLanguages: ["Português"],
  blockedSeniorities: [],
  blockedWorkTypes: [],
  coreStack: [],
  stackExceptions: [],
  anchorProject: "",
  discloseGapsInEmail: true,
  aiMonthlyTokenLimit: 100_000,
});

export const emptyProfileChoices = (): ProfileChoices => ({
  seniority: [], preferredMode: [], masteredSkills: [], desiredAreas: [], avoidTerms: [], minScore: 60,
  careerRules: emptyCareerRules(),
});

export function alexsandroProfilePreset(): ProfileChoices {
  return {
    seniority: ["Sênior", "Arquiteto"],
    preferredMode: ["Remoto", "Híbrido"],
    masteredSkills: [
      "C#", ".NET", "AWS", "RabbitMQ", "SQL Server", "React",
      "GitHub Actions", "Terraform", "VB6", "WCF",
    ],
    desiredAreas: ["Desenvolvimento Back-end", "Arquitetura de Software", "Cloud", "Full Stack", "Qualidade / QA"],
    avoidTerms: [],
    minScore: 0,
    careerRules: {
      professionalName: "Alexsandro Ramos",
      professionalTitle: "Desenvolvedor .NET Pleno",
      professionalSummary: "Desenvolvedor .NET com experiência em C#, .NET 8/10, MediatR, Polly, AWS (ECS Fargate, ALB, SQS e S3), RabbitMQ com MassTransit, SQL Server, React, GitHub Actions e Terraform. Possui experiência profunda com sistemas legados em VB6, COM+, MTS, WebForms e WCF, especialmente em modernização de arquiteturas. Utiliza Claude Code diariamente como ferramenta de desenvolvimento assistido.",
      baseLocation: "Mogi das Cruzes, SP",
      acceptedRegions: ["Grande São Paulo"],
      maxHybridDays: 2,
      preferredContracts: ["PJ", "CLT"],
      dailyCommunicationLanguages: ["Português"],
      blockedSeniorities: ["Júnior", "Analista"],
      blockedWorkTypes: ["Sustentação", "Suporte"],
      coreStack: ["C#", ".NET"],
      stackExceptions: ["VBA + Access + SQL Server", "QA .NET"],
      anchorProject: "o Sistema AMR: arquitetura multimodular com módulo Financeiro CP/ACID em SQL Server, módulo Fábrica AP/BASE em SQLite + EFS e infraestrutura na AWS com ECS Fargate e Application Load Balancer. O projeto demonstra decisões conscientes sobre consistência, disponibilidade, arquitetura poliglota de dados e modernização de sistemas legados.",
      discloseGapsInEmail: true,
      aiMonthlyTokenLimit: 100_000,
    },
  };
}

export function normalizeCareerRules(value: unknown): CareerRules {
  let candidate: Record<string, unknown> = {};
  if (typeof value === "string" && value.trim()) {
    try { candidate = JSON.parse(value) as Record<string, unknown>; } catch { candidate = {}; }
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    candidate = value as Record<string, unknown>;
  }
  const defaults = emptyCareerRules();
  const text = (key: keyof CareerRules) => typeof candidate[key] === "string" ? String(candidate[key]).trim().slice(0, 4000) : String(defaults[key] ?? "");
  const list = (key: keyof CareerRules) => listFromStored(candidate[key]).slice(0, 100);
  const hybridDays = Number(candidate.maxHybridDays);
  return {
    professionalName: text("professionalName").slice(0, 120),
    professionalTitle: text("professionalTitle").slice(0, 120),
    professionalSummary: text("professionalSummary"),
    baseLocation: text("baseLocation").slice(0, 160),
    acceptedRegions: list("acceptedRegions"),
    maxHybridDays: Number.isFinite(hybridDays) ? Math.max(0, Math.min(7, Math.round(hybridDays))) : defaults.maxHybridDays,
    preferredContracts: list("preferredContracts").filter(item => CONTRACT_OPTIONS.includes(item)),
    dailyCommunicationLanguages: list("dailyCommunicationLanguages"),
    blockedSeniorities: list("blockedSeniorities"),
    blockedWorkTypes: list("blockedWorkTypes"),
    coreStack: list("coreStack"),
    stackExceptions: list("stackExceptions"),
    anchorProject: text("anchorProject"),
    discloseGapsInEmail: typeof candidate.discloseGapsInEmail === "boolean" ? candidate.discloseGapsInEmail : defaults.discloseGapsInEmail,
    aiMonthlyTokenLimit: Number.isFinite(Number(candidate.aiMonthlyTokenLimit)) ? Math.max(0, Math.min(10_000_000, Math.round(Number(candidate.aiMonthlyTokenLimit)))) : defaults.aiMonthlyTokenLimit,
  };
}

export function listFromStored(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map(item => item.trim());
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return listFromStored(parsed);
  } catch { /* legacy comma-separated preference */ }
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

export function allowedWorkModes(value: unknown): string[] {
  return listFromStored(value).filter(mode => WORK_MODE_OPTIONS.includes(mode));
}

export function normalizeMinScore(value: unknown, fallback = 60): number {
  if (value === null || value === undefined || value === "") return fallback;
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : fallback;
}
