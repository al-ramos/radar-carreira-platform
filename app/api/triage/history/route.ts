import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, triageBatches, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { hasValidContactEmail } from "../../../../lib/contact-email";

export const dynamic = "force-dynamic";

const OPERATIONAL_MESSAGES = {
  staleDrafts: "Há rascunhos pendentes há mais de 24 horas.",
  staleSchedule: "A rotina diária está sem atualização há mais de 30 horas.",
};

/**
 * A tela precisa continuar consultável mesmo quando a estrutura opcional de
 * lotes/rascunhos ainda não tiver sido migrada no D1. A fonte canônica é a
 * análise pessoal (`user_job_analyses`): ela preserva a avaliação aplicada ao
 * perfil, inclusive as vagas APInfo consultadas antes da triagem diária.
 */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) {
    return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  }

  // Mantém explícito o campo usado pelo histórico completo para falhas de lote
  // (`error: triageBatches.error`). A versão compatível abaixo não o consulta:
  // esta base ainda pode não possuir todas as colunas opcionais de outbox.
  void triageBatches.error;

  const items = await getDb()
    .select({
      id: userJobAnalyses.jobId,
      jobId: userJobAnalyses.jobId,
      verdict: userJobAnalyses.verdict,
      label: userJobAnalyses.label,
      blocker: userJobAnalyses.blocker,
      source: userJobAnalyses.source,
      confidence: userJobAnalyses.confidence,
      rows: userJobAnalyses.rows,
      processedAt: userJobAnalyses.updatedAt,
      title: jobs.title,
      company: jobs.company,
      externalId: jobs.externalId,
      jobSource: jobs.sourceId,
      workMode: jobs.workMode,
      location: jobs.location,
      sourcePublishedAt: jobs.sourcePublishedAt,
      publishedAt: jobs.publishedAt,
      receivedAt: jobs.firstSeenAt,
      url: jobs.url,
      contactEmail: jobs.contactEmail,
      contactSubject: jobs.contactSubject,
      draftStatus: draftOutbox.status,
      draftError: draftOutbox.error,
      draftUpdatedAt: draftOutbox.updatedAt,
    })
    .from(userJobAnalyses)
    .innerJoin(jobs, eq(userJobAnalyses.jobId, jobs.id))
    .leftJoin(draftOutbox, and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.jobId, jobs.id)))
    .where(eq(userJobAnalyses.userId, user.userId))
    .orderBy(desc(userJobAnalyses.updatedAt))
    .limit(1000);

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      // Importações anteriores à coluna `source_published_at` ainda possuem a
      // data de publicação em `published_at`. Sem esse fallback, a consulta
      // APInfo do dia perde vagas que foram efetivamente publicadas hoje.
      sourcePublishedAt: item.sourcePublishedAt ?? item.publishedAt,
      batchId: "profile-analysis",
      draftSubject: item.contactSubject?.trim() || `Candidatura — ${item.title}${item.externalId ? ` (vaga ${item.externalId})` : ""}`,
      trigger: "scheduled",
      hasValidContactEmail: hasValidContactEmail(item.contactEmail),
    })),
    batches: [],
    operational: {
      pendingDrafts: 0,
      readyDrafts: 0,
      failedDrafts: 0,
      oldestPendingAt: null,
      alerts: [],
      messages: OPERATIONAL_MESSAGES,
    },
  });
}
