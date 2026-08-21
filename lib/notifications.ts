import { getDb } from "../db/index";
import { notifications } from "../db/schema";

export type NotificationType = "import" | "report" | "digest" | "pipeline";
export type NotificationSeverity = "success" | "error" | "info";

export type CreateNotificationInput = {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Grava uma notificação no histórico único (sino no portal).
 *
 * Sem `userId`: hoje só a proprietária opera fontes/importações, e a rota
 * de leitura (`/api/notifications`) já restringe por `isOwnerEmail()`. Ver
 * o comentário em `db/schema.ts` sobre `notifications` para o raciocínio
 * completo antes de adicionar segmentação por usuário.
 */
export async function createNotification(db: ReturnType<typeof getDb>, input: CreateNotificationInput) {
  await db.insert(notifications).values({
    id: crypto.randomUUID(),
    type: input.type,
    severity: input.severity,
    title: input.title,
    body: input.body ?? "",
    link: input.link ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
    read: false,
    createdAt: new Date(),
  });
}

export type ImportRunOutcome = {
  runId: string;
  source: string;
  status: "completed" | "failed";
  received: number;
  valid?: number;
  invalid?: number;
  invalidReasons?: Record<string, number>;
  rejectedProfile?: number;
  inserted: number;
  updated: number;
  duplicates?: number;
  error?: string;
};

const numberFormat = new Intl.NumberFormat("pt-BR");

/**
 * Notificação padrão para o fim de uma execução de import_runs (sucesso ou
 * falha), chamada nos seis pontos que já gravam status "completed"/"failed"
 * em `import_runs`: importação manual, extensão LinkedIn (legado e por
 * sourceId), Gmail RadarVagas e coleta agendada por conector.
 */
export async function notifyImportRun(db: ReturnType<typeof getDb>, outcome: ImportRunOutcome) {
  const success = outcome.status === "completed";
  const title = success ? `Importação concluída — ${outcome.source}` : `Importação falhou — ${outcome.source}`;
  const parts = success
    ? [
        `${numberFormat.format(outcome.received)} recebida${outcome.received === 1 ? "" : "s"}`,
        ...(typeof outcome.valid === "number" ? [`${numberFormat.format(outcome.valid)} válida${outcome.valid === 1 ? "" : "s"} para processar`] : []),
        ...(outcome.invalid ? [`${numberFormat.format(outcome.invalid)} ${outcome.invalid === 1 ? "não entrou" : "não entraram"} (${Object.entries(outcome.invalidReasons ?? {}).map(([reason, count]) => `${reason}: ${numberFormat.format(count)}`).join(", ") || "dados obrigatórios ausentes"})`] : []),
        ...(outcome.rejectedProfile ? [`${numberFormat.format(outcome.rejectedProfile)} rejeitada${outcome.rejectedProfile === 1 ? "" : "s"} pelo perfil`] : []),
        `${numberFormat.format(outcome.inserted)} nova${outcome.inserted === 1 ? "" : "s"}`,
        `${numberFormat.format(outcome.updated)} atualizada${outcome.updated === 1 ? "" : "s"}`,
        ...(outcome.duplicates ? [`${numberFormat.format(outcome.duplicates)} duplicada${outcome.duplicates === 1 ? "" : "s"}`] : []),
      ]
    : [outcome.error?.trim() || "Falha não identificada. Veja Auditoria para detalhes."];
  await createNotification(db, {
    type: "import",
    severity: success ? "success" : "error",
    title,
    body: parts.join(" · "),
    link: "/?open=importacoes",
    metadata: { runId: outcome.runId, source: outcome.source, received: outcome.received, valid: outcome.valid ?? null, invalid: outcome.invalid ?? 0, invalidReasons: outcome.invalidReasons ?? {}, rejectedProfile: outcome.rejectedProfile ?? 0, inserted: outcome.inserted, updated: outcome.updated, duplicates: outcome.duplicates ?? 0, error: outcome.error ?? null },
  });
}
