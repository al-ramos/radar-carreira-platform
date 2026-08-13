export const JOB_AREAS = [
  { id: "backend", label: "Back-end" },
  { id: "frontend", label: "Front-end" },
  { id: "fullstack", label: "Full Stack" },
  { id: "devops", label: "DevOps / SRE / Cloud" },
  { id: "data", label: "Dados / BI / IA" },
  { id: "mobile", label: "Mobile" },
  { id: "qa", label: "QA / Testes" },
  { id: "security", label: "Segurança" },
  { id: "infrastructure", label: "Infraestrutura / Suporte" },
  { id: "product", label: "Produto / UX" },
  { id: "management", label: "Gestão de Tecnologia" },
  { id: "other", label: "Outras áreas" },
] as const;

export type JobArea = typeof JOB_AREAS[number]["id"];

const rules: Array<{ area: JobArea; patterns: RegExp[] }> = [
  { area: "fullstack", patterns: [/full\s*stack/i, /fullstack/i] },
  { area: "devops", patterns: [/devops/i, /devsecops/i, /\bsre\b/i, /site reliability/i, /platform engineer/i, /cloud engineer/i] },
  { area: "security", patterns: [/cyber/i, /seguran[cç]a/i, /security/i, /\bsoc\b/i, /appsec/i, /pentest/i] },
  { area: "data", patterns: [/data engineer/i, /engenheir[oa] de dados/i, /data scientist/i, /cientista de dados/i, /analytics/i, /business intelligence/i, /\bbi\b/i, /machine learning/i, /intelig[êe]ncia artificial/i] },
  { area: "mobile", patterns: [/mobile/i, /android/i, /\bios\b/i, /flutter/i, /react native/i] },
  { area: "qa", patterns: [/quality assurance/i, /\bqa\b/i, /teste[s]? de software/i, /test automation/i, /sdet/i] },
  { area: "frontend", patterns: [/front[ -]?end/i, /frontend/i, /react developer/i, /angular developer/i, /web designer/i] },
  { area: "backend", patterns: [/back[ -]?end/i, /backend/i, /software engineer/i, /desenvolvedor/i, /developer/i, /programador/i] },
  { area: "infrastructure", patterns: [/infraestrutura/i, /infrastructure/i, /suporte/i, /support/i, /network/i, /redes/i, /sysadmin/i] },
  { area: "product", patterns: [/product manager/i, /product owner/i, /product designer/i, /ux/i, /ui designer/i] },
  { area: "management", patterns: [/engineering manager/i, /tech lead/i, /gerente de tecnologia/i, /coordenador.*tecnologia/i, /head of/i, /cto/i] },
];

export function inferJobArea(input: { title?: string; description?: string; stack?: string[] }): JobArea {
  const text = `${input.title ?? ""} ${input.description ?? ""} ${(input.stack ?? []).join(" ")}`;
  return rules.find(rule => rule.patterns.some(pattern => pattern.test(text)))?.area ?? "other";
}

export function jobAreaLabel(area: string | null | undefined) {
  return JOB_AREAS.find(option => option.id === area)?.label ?? "Outras áreas";
}
