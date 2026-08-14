export type SkillFamily = { key: string; label: string; aliases: string[] };

export const SCORE_SKILL_FAMILIES: SkillFamily[] = [
  { key: "dotnet", label: ".NET", aliases: ["C#", ".NET", "dotnet", "ASP.NET", "ASP.NET Core", "ASPNet", "VB.NET"] },
  { key: "relational-db", label: "Bancos relacionais", aliases: ["SQL", "SQL Server", "T-SQL", "MySQL", "PostgreSQL", "Postgres", "Oracle", "SQLite", "PL/SQL"] },
  { key: "visual-basic", label: "Visual Basic", aliases: ["Visual Basic", "VB6", "VB.6", "VBA"] },
  { key: "javascript", label: "JavaScript/TypeScript", aliases: ["JavaScript", "TypeScript", "ECMAScript"] },
  { key: "node", label: "Node.js", aliases: ["Node.js", "NodeJS", "NestJS", "Express"] },
  { key: "react", label: "React", aliases: ["React", "React.js", "Next.js", "NextJS"] },
  { key: "angular", label: "Angular", aliases: ["Angular", "AngularJS"] },
  { key: "java", label: "Java/JVM", aliases: ["Java", "Spring", "Spring Boot", "Quarkus", "Kotlin"] },
  { key: "python", label: "Python", aliases: ["Python", "Django", "FastAPI", "Flask"] },
  { key: "aws", label: "AWS", aliases: ["AWS", "Amazon Web Services"] },
  { key: "azure", label: "Azure", aliases: ["Azure", "Microsoft Azure"] },
  { key: "gcp", label: "Google Cloud", aliases: ["GCP", "Google Cloud", "Google Cloud Platform"] },
  { key: "devops", label: "DevOps", aliases: ["DevOps", "Docker", "Kubernetes", "Terraform", "CI/CD"] },
];

// Equivalências conservadoras: servem para requisitos, sugestões e
// deduplicação. Famílias amplas do score (por exemplo, bancos relacionais)
// continuam separadas para não afirmar que Oracle e PostgreSQL são iguais.
const EQUIVALENT_SKILL_GROUPS = [
  ["gcp", "google cloud", "google cloud platform"],
  ["aws", "amazon web services"],
  ["azure", "microsoft azure"],
  ["c#", "csharp", ".net", "dotnet", "net core", ".net core", "asp.net", "asp net", "c# / .net", "c#/.net", "c# .net"],
  ["sql", "sql server", "mssql"],
  ["postgres", "postgresql"],
  ["node", "node.js", "nodejs"],
  ["react", "react.js", "reactjs"],
  ["vue", "vue.js", "vuejs"],
  ["next", "next.js", "nextjs"],
  ["kubernetes", "k8s"],
] as const;

const NON_SKILL_JOB_TAGS = new Set(["dados / bi", "dados/bi"]);

export function normalizeSkill(skill: string): string {
  return skill.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
}

export function scoreFamilyForSelection(selection: string): SkillFamily | undefined {
  const selected = normalizeSkill(selection);
  return SCORE_SKILL_FAMILIES.find(family => family.aliases.some(alias => normalizeSkill(alias) === selected));
}

export function skillsAreEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizeSkill(left);
  const normalizedRight = normalizeSkill(right);
  if (normalizedLeft === normalizedRight) return true;
  return EQUIVALENT_SKILL_GROUPS.some(group =>
    group.includes(normalizedLeft as never) && group.includes(normalizedRight as never),
  );
}

export function uniqueEquivalentSkills(skills: string[]): string[] {
  const unique: string[] = [];
  for (const skill of skills.map(item => item.trim()).filter(Boolean)) {
    if (!unique.some(existing => skillsAreEquivalent(existing, skill))) unique.push(skill);
  }
  return unique;
}

export function isTechnicalSkillTag(skill: string): boolean {
  return !NON_SKILL_JOB_TAGS.has(normalizeSkill(skill));
}
