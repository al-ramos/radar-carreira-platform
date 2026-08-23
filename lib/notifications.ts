import { getDb } from "../db/index";
import { notifications } from "../db/schema";

export type NotificationType = "import" | "report" | "digest" | "pipeline" | "application" | "triage";
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

export type DraftSentOutcome = {
  outboxId: string;
  title: string;
  company: string;
  externalId?: string | null;
  to: string;
  sentAt: Date;
};

/**
 * Notificação disparada quando `reconcileSent` confirma, por evidência da
 * pasta "Enviados" do Gmail, que um rascunho da outbox já foi enviado
 * manualmente pelo usuário. Não representa nenhum envio feito pelo Radar —
 * só o registro de algo que o usuário já fez fora do portal. Ver ADR-007
 * (nenhum envio automático de candidatura).
 */
export type ScheduledTriageOutcome = {
  batchId: string;
  processed: number;
  approved: number;
  probable: number;
  rejected: number;
  draftsQueued: number;
  error?: string;
};

/**
 * Notificação padrão ao fim de uma rodada da triagem agendada (Etapa 4 da
 * automação ponta a ponta). Resume o que a rodada fez para observabilidade
 * sem precisar abrir Auditoria/Histórico: quantas vagas foram avaliadas, e
 * o desfecho de cada veredito (✅ entra na fila de rascunho quando o
 * interruptor de fila está ligado; 🟡 fica esperando revisão manual). A
 * criação do rascunho no Gmail continua sendo uma ação manual do portal —
 * esta notificação não afirma nem sugere que algo foi enviado. Não dispara
 * quando a rodada não teve nenhuma vaga nova (evita ruído no sino em
 * execuções vazias, que são a maioria em horário comercial).
 */
export async function notifyScheduledTriage(db: ReturnType<typeof getDb>, outcome: ScheduledTriageOutcome) {
  if (outcome.error) {
    await createNotification(db, {
      type: "triage",
      severity: "error",
      title: "Triagem agendada falhou",
      body: outcome.error,
      link: "/?open=triagem",
      metadata: { batchId: outcome.batchId, error: outcome.error },
    });
    return;
  }
  if (!outcome.processed) return;
  const parts = [
    `${numberFormat.format(outcome.processed)} vaga${outcome.processed === 1 ? "" : "s"} avaliada${outcome.processed === 1 ? "" : "s"}`,
    `${numberFormat.format(outcome.approved)} aprovada${outcome.approved === 1 ? "" : "s"}`,
    `${numberFormat.format(outcome.probable)} ${outcome.probable === 1 ? "provável" : "prováveis"} aguardando você`,
    ...(outcome.rejected ? [`${numberFormat.format(outcome.rejected)} não aderente${outcome.rejected === 1 ? "" : "s"}`] : []),
    ...(outcome.draftsQueued ? [`${numberFormat.format(outcome.draftsQueued)} na fila de rascunho`] : []),
  ];
  await createNotification(db, {
    type: "triage",
    severity: "success",
    title: "Triagem agendada concluída",
    body: parts.join(" · "),
    link: "/?open=triagem",
    metadata: { batchId: outcome.batchId, processed: outcome.processed, approved: outcome.approved, probable: outcome.probable, rejected: outcome.rejected, draftsQueued: outcome.draftsQueued },
  });
}

export async function notifyDraftSent(db: ReturnType<typeof getDb>, outcome: DraftSentOutcome) {
  await createNotification(db, {
    type: "application",
    severity: "success",
    title: `Candidatura enviada — ${outcome.company}`,
    body: `${outcome.title}${outcome.externalId ? ` (vaga ${outcome.externalId})` : ""} · para ${outcome.to}`,
    link: "/?open=triagem",
    metadata: { outboxId: outcome.outboxId, title: outcome.title, company: outcome.company, externalId: outcome.externalId ?? null, to: outcome.to, sentAt: outcome.sentAt.toISOString() },
  });
}
