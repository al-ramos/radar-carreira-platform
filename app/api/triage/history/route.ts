import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobAiTriage, jobs } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { hasValidContactEmail } from "../../../../lib/contact-email";

export const dynamic = "force-dynamic";

/**
 * A tela precisa continuar consultável mesmo quando a estrutura opcional de
 * lotes/rascunhos ainda não tiver sido migrada no D1. A fonte canônica para a
 * triagem diária é `job_ai_triage`: ela contém cada vaga efetivamente avaliada
 * e não depende da fila de rascunhos.
 */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) {
    return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  }

  const items = await getDb()
    .select({
      id: jobAiTriage.jobId,
      jobId: jobAiTriage.jobId,
      verdict: jobAiTriage.veredito,
      label: jobAiTriage.motivo,
      processedAt: jobAiTriage.processedAt,
      title: jobs.title,
      company: jobs.company,
      externalId: jobs.externalId,
      jobSource: jobs.sourceId,
      workMode: jobs.workMode,
      location: jobs.location,
      sourcePublishedAt: jobs.sourcePublishedAt,
      receivedAt: jobs.firstSeenAt,
      url: jobs.url,
      contactEmail: jobs.contactEmail,
      contactSubject: jobs.contactSubject,
    })
    .from(jobAiTriage)
    .innerJoin(jobs, eq(jobAiTriage.jobId, jobs.id))
    .where(sql`${jobAiTriage.veredito} != '⚪'`)
    .orderBy(desc(jobAiTriage.processedAt))
    .limit(1000);

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      batchId: "daily-triage",
      blocker: null,
      source: "rules",
      confidence: 100,
      rows: "[]",
      draftStatus: null,
      draftError: null,
      draftUpdatedAt: null,
      draftSubject: item.contactSubject?.trim() || `Candidatura — ${item.title}${item.externalId ? ` (vaga ${item.externalId})` : ""}`,
      trigger: "scheduled",
      hasValidContactEmail: hasValidContactEmail(item.contactEmail),
    })),
    batches: [],
    operational: null,
  });
}
