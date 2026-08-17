import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobAiTriage, jobs } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";

export const dynamic = "force-dynamic";

// ⚪ é a marcação neutra de backlog pré-automação (nunca atribuída pela task
// diária a uma avaliação real) e não faz parte do enum tipado da coluna
// `veredito` (só ✅/🟡/🔴/❌). Por isso a comparação usa `sql` em vez de
// `ne()`/`eq()` do Drizzle, que rejeitaria "⚪" em tempo de compilação.
const NOT_BACKLOG = sql`${jobAiTriage.veredito} != '⚪'`;

/**
 * Consulta de leitura sobre job_ai_triage, que antes só era acessível via
 * SQL direto no D1. Por padrão traz somente os vereditos reais (✅/🟡/🔴/❌);
 * `?includeBacklog=1` inclui também as marcações ⚪ ainda não avaliadas.
 */
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email))
    return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });

  const includeBacklog = new URL(request.url).searchParams.get("includeBacklog") === "1";
  const db = getDb();

  const countRows = await db
    .select({ veredito: jobAiTriage.veredito, total: sql<number>`count(*)` })
    .from(jobAiTriage)
    .groupBy(jobAiTriage.veredito);
  const counts: Record<string, number> = {};
  for (const row of countRows) counts[row.veredito] = row.total;

  const items = await db
    .select({
      jobId: jobAiTriage.jobId,
      veredito: jobAiTriage.veredito,
      motivo: jobAiTriage.motivo,
      processedAt: jobAiTriage.processedAt,
      title: jobs.title,
      company: jobs.company,
      workMode: jobs.workMode,
      location: jobs.location,
      url: jobs.url,
    })
    .from(jobAiTriage)
    .innerJoin(jobs, eq(jobAiTriage.jobId, jobs.id))
    .where(includeBacklog ? undefined : NOT_BACKLOG)
    .orderBy(desc(jobAiTriage.processedAt))
    .limit(1000);

  return NextResponse.json({
    counts,
    total: countRows.reduce((sum, row) => sum + row.total, 0),
    items,
  });
}
