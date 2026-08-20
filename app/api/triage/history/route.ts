import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, triageBatches, triageHistory } from "../../../../db/schema";
import { hasValidContactEmail } from "../../../../lib/contact-email";

export const dynamic = "force-dynamic";

/** Histórico pessoal e persistente da nova triagem. Nunca consulta resultados
 * de outro usuário e não cria rascunhos nem altera vagas. */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  const items = await getDb()
    .select({
      id: triageHistory.id,
      batchId: triageHistory.batchId,
      verdict: triageHistory.verdict,
      label: triageHistory.label,
      blocker: triageHistory.blocker,
      source: triageHistory.source,
      confidence: triageHistory.confidence,
      processedAt: triageHistory.createdAt,
      title: jobs.title,
      company: jobs.company,
      contactEmail: jobs.contactEmail,
      trigger: triageBatches.trigger,
    })
    .from(triageHistory)
    .innerJoin(jobs, eq(triageHistory.jobId, jobs.id))
    .innerJoin(triageBatches, eq(triageHistory.batchId, triageBatches.id))
    .where(eq(triageHistory.userId, user.userId))
    .orderBy(desc(triageHistory.createdAt))
    .limit(100);

  return NextResponse.json({
    items: items.map((item) => ({ ...item, hasValidContactEmail: hasValidContactEmail(item.contactEmail) })),
  });
}
