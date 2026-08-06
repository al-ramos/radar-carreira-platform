export const SENIORITY_OPTIONS = [
  "Estágio", "Trainee", "Júnior", "Pleno", "Sênior", "Especialista",
  "Tech Lead", "Coordenador", "Gerente", "Diretor",
];

export const WORK_MODE_OPTIONS = ["Remoto", "Híbrido", "Presencial"];

export const CITY_OPTIONS = [
  "Remoto - Brasil", "São Paulo, SP", "Rio de Janeiro, RJ", "Belo Horizonte, MG",
  "Brasília, DF", "Curitiba, PR", "Porto Alegre, RS", "Florianópolis, SC",
  "Campinas, SP", "Recife, PE", "Salvador, BA", "Fortaleza, CE", "Goiânia, GO",
  "Vitória, ES", "Manaus, AM", "Belém, PA",
];

export const SKILL_OPTIONS = [
  "JavaScript", "TypeScript", "React", "Angular", "Vue.js", "Next.js", "Node.js",
  "Java", "Spring", "Python", "Django", "FastAPI", "C#", ".NET", "PHP", "Laravel",
  "Go", "Ruby", "Rails", "Kotlin", "Swift", "SQL Server", "PostgreSQL", "MySQL",
  "Oracle", "MongoDB", "Redis", "Kafka", "Power BI", "SAP", "Salesforce", "AWS",
  "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "Linux", "Git", "REST",
  "GraphQL", "SIEM", "SOC", "IAM",
];

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
  cities: string[];
  masteredSkills: string[];
  desiredAreas: string[];
  avoidTerms: string[];
  minScore: number;
};

export const emptyProfileChoices = (): ProfileChoices => ({
  seniority: [], preferredMode: [], cities: [], masteredSkills: [], desiredAreas: [], avoidTerms: [], minScore: 60,
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
