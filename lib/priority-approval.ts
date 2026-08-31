const PRIORITY_TECHNOLOGY_RE = [
  /(?:^|[^a-z0-9+#.])c#(?=$|[^a-z0-9+#.])/i,
  /(?:^|[^a-z0-9])\.net(?=$|[^a-z0-9])/i,
  /(?:^|[^a-z0-9])sql\s*server(?=$|[^a-z0-9])/i,
  /(?:^|[^a-z0-9])(?:vb\s*6|vb6|visual\s+basic|vba)(?=$|[^a-z0-9])/i,
];

/**
 * Tecnologias com prioridade explícita do candidato. A ocorrência pode estar
 * tanto entre requisitos quanto em "diferenciais". Ela reforça o fit
 * técnico, mas não substitui os critérios obrigatórios de modalidade,
 * localidade, senioridade, idioma e evidência no texto da vaga.
 */
export function priorityApprovalReason(value: string): string | null {
  const match = PRIORITY_TECHNOLOGY_RE.find((pattern) => pattern.test(value));
  if (!match) return null;
  if (/(?:^|[^a-z0-9+#.])c#(?=$|[^a-z0-9+#.])/i.test(value)) return "C#";
  if (/(?:^|[^a-z0-9])\.net(?=$|[^a-z0-9])/i.test(value)) return ".NET";
  if (/(?:^|[^a-z0-9])sql\s*server(?=$|[^a-z0-9])/i.test(value)) return "SQL Server";
  if (/(?:^|[^a-z0-9])(?:vb\s*6|vb6)(?=$|[^a-z0-9])/i.test(value)) return "VB6";
  if (/(?:^|[^a-z0-9])visual\s+basic(?=$|[^a-z0-9])/i.test(value)) return "Visual Basic";
  return "VBA";
}
