import { sql } from "drizzle-orm";
import { jobs, triageHistory } from "../db/schema";
import type { AnalysisVersions } from "./analysis-versions";

/**
 * Fonte única de verdade para saber se uma vaga foi triada com o perfil,
 * regras e instruções atuais. `user_job_analyses` é um snapshot útil para a
 * Home, mas também contém pontuações e análises antigas; por isso não pode
 * sozinho retirar uma vaga da fila.
 */
export function hasCurrentTriage(userId: string, versions: AnalysisVersions) {
  return sql<boolean>`exists (
    select 1 from ${triageHistory}
    where ${triageHistory.userId} = ${userId}
      and ${triageHistory.jobId} = ${jobs.id}
      and ${triageHistory.profileRevision} = ${versions.profileRevision}
      and ${triageHistory.rulesRevision} = ${versions.rulesRevision}
      and ${triageHistory.instructionsRevision} = ${versions.instructionsRevision}
      and ${triageHistory.createdAt} >= ${jobs.triageInputUpdatedAt}
  )`;
}

export function needsCurrentTriage(userId: string, versions: AnalysisVersions) {
  return sql<boolean>`not (${hasTriageableDescription()} and ${hasCurrentTriage(userId, versions)})`;
}

/**
 * Descrição vazia não contém evidência suficiente para aplicar bloqueadores,
 * requisitos, senioridade ou idioma. Essas vagas permanecem pendentes, mas
 * não entram na classificação até uma nova coleta íntegra.
 */
export function hasTriageableDescription() {
  return sql<boolean>`length(trim(coalesce(${jobs.description}, ''))) >= 80`;
}
