export const SENIORITY_OPTIONS = [
  "Estágio", "Trainee", "Júnior", "Pleno", "Sênior", "Especialista",
  "Tech Lead", "Coordenador", "Gerente", "Diretor",
];

export const WORK_MODE_OPTIONS = ["Remoto", "Presencial"];

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
  "Estágio", "Trainee", "Júnior", "Presencial", "Vendas", "Comercial",
  "Suporte", "Atendimento", "Freelancer", "Temporário",
];

export type ProfileChoices = {
  seniority: string[];
  preferredMode: string[];
  masteredSkills: string[];
  desiredAreas: string[];
  avoidTerms: string[];
  minScore: number;
};

export const emptyProfileChoices = (): ProfileChoices => ({
  seniority: [], preferredMode: [], masteredSkills: [], desiredAreas: [], avoidTerms: [], minScore: 60,
});

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
