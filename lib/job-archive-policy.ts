/** Vagas fora do recorte operacional permanecem consultáveis, mas nunca voltam
 * à fila ativa. Prioriza-se a publicação da fonte; sem ela, o recebimento. */
export const ARCHIVE_BEFORE = new Date("2026-08-15T00:00:00-03:00");

export function shouldArchiveImportedJob(sourcePublishedAt: Date | null, receivedAt: Date): boolean {
  return (sourcePublishedAt ?? receivedAt).getTime() < ARCHIVE_BEFORE.getTime();
}
