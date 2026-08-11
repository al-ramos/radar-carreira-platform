import { eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, jobSources, userJobStatus } from "../../../../db/schema";

export const dynamic = "force-dynamic";

const csv = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""').replace(/[\r\n]+/g, " ")}"`;

type ReportRow = {
  id: string;
  score?: number;
  verdict?: string;
};

/**
 * O relatório espelha exatamente o que está visível na tela no momento do
 * download: o Dashboard já aplicou período, fonte, busca, score mínimo,
 * etapa do pipeline e veredito no client (sobre as vagas já carregadas via
 * paginação) e manda aqui a lista final de IDs — junto com o score e
 * veredito já calculados — para não haver risco de o servidor recalcular
 * um resultado diferente do que a pessoa está vendo (ex.: filtrar contra
 * as 1042 vagas do período inteiro em vez das 42 carregadas na tela).
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json({ error: "Autenticação necessária" }, { status: 401 });

  let body: { rows?: ReportRow[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corpo inválido" }, { status: 400 });
  }
  const requested = Array.isArray(body.rows) ? body.rows.filter((r) => r?.id) : [];
  if (requested.length === 0) {
    return Response.json({ error: "Nenhuma vaga para exportar" }, { status: 400 });
  }

  const db = getDb();
  const ids = requested.map((r) => r.id);
  const [rows, pipeline] = await Promise.all([
    db
      .select({ job: jobs, source: jobSources.name })
      .from(jobs)
      .leftJoin(jobSources, eq(jobs.sourceId, jobSources.id))
      .where(inArray(jobs.id, ids)),
    db
      .select()
      .from(userJobStatus)
      .where(eq(userJobStatus.userId, user.userId)),
  ]);
  const byJob = new Map(rows.map((r) => [r.job.id, r]));
  const byStatus = new Map(pipeline.map((item) => [item.jobId, item]));

  const header = [
    "Data da coleta",
    "Data de publicação",
    "Fonte",
    "Código",
    "Cargo",
    "Empresa",
    "Localização",
    "Modalidade",
    "Senioridade",
    "Aderência",
    "Veredito",
    "Tecnologias",
    "Descrição detalhada",
    "Link",
    "Status",
    "Etapa do pipeline",
    "Observações",
  ];
  // Mantém a ordem em que as vagas apareciam na tela, e pula silenciosamente
  // qualquer ID que não exista mais (vaga removida entre o carregamento e o clique).
  const lines = requested.flatMap(({ id, score, verdict }) => {
    const found = byJob.get(id);
    if (!found) return [];
    const { job, source } = found;
    const state = byStatus.get(job.id);
    return [
      [
        job.firstSeenAt.toISOString(),
        job.publishedAt?.toISOString() ?? "",
        source ?? "Importação manual",
        job.externalId ?? "",
        job.title,
        job.company,
        job.location,
        job.workMode,
        job.seniority,
        score !== undefined ? `${score}%` : "",
        verdict ?? "",
        JSON.parse(job.stack || "[]").join(", "),
        job.description,
        job.url,
        job.status,
        state?.stage ?? "new",
        state?.note ?? "",
      ]
        .map(csv)
        .join(";"),
    ];
  });

  const csvBody = `﻿${header.map(csv).join(";")}\r\n${lines.join("\r\n")}`;
  return new Response(csvBody, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="radar-vagas-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
