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
  )`;
}

export function needsCurrentTriage(userId: string, versions: AnalysisVersions) {
  return sql<boolean>`not (${hasCurrentTriage(userId, versions)})`;
}
