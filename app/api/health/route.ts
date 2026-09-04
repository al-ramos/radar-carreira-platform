import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../db/index";
import { automationHeartbeats, jobs } from "../../../db/schema";
export const dynamic="force-dynamic";

/**
 * Verificação pública de saúde. Continua respondendo o mesmo contrato de
 * antes — status, database, responseMs, checkedAt — com duas mudanças:
 *
 * - o motivo da falha ia para lugar nenhum (`catch{}` sem corpo); agora vai
 *   para o log estruturado, que é onde dá para investigar;
 * - inclui o batimento mais recente, para distinguir "banco de pé e automações
 *   paradas" de "tudo parado", que é a pergunta que a tela de acesso e o
 *   Monitoramento realmente fazem.
 *
 * Segue sem exigir sessão, porque uma verificação que exige login não serve
 * quando o problema é justamente entrar, e sem devolver dado de negócio.
 */
export async function GET() {
  const started = Date.now();
  try {
    const db = getDb();
    await db.select({ id: jobs.id }).from(jobs).limit(1);
    const latest = (await db.select({ id: automationHeartbeats.id, status: automationHeartbeats.status, updatedAt: automationHeartbeats.updatedAt })
      .from(automationHeartbeats).orderBy(desc(automationHeartbeats.updatedAt)).limit(1))[0];
    return NextResponse.json({
      status: "healthy",
      database: "connected",
      responseMs: Date.now() - started,
      lastAutomation: latest ? { id: latest.id, status: latest.status, updatedAt: latest.updatedAt.toISOString() } : null,
      checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({
      event: "health_check_failed",
      error: error instanceof Error ? error.message : "sem motivo informado",
    }));
    return NextResponse.json({
      status: "degraded",
      database: "unavailable",
      responseMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
