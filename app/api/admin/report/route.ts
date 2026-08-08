import { and, desc, eq, gte } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, jobSources, profiles, userJobStatus } from "../../../../db/schema";

export const dynamic = "force-dynamic";
const ADMIN_EMAILS = new Set(["contato@amrsolution.com.br", "alexsandro.ramos@gmail.com", "prof.andreiamr@gmail.com"]);
const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""').replace(/[\r\n]+/g, " ")}"`;

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({error:"Autenticação necessária"},{status:401});
  const db = getDb();
  const profile = (await db.select({role:profiles.role}).from(profiles).where(eq(profiles.userId,user.userId)).limit(1))[0];
  if (profile?.role !== "admin" && !ADMIN_EMAILS.has(user.email.toLowerCase())) return Response.json({error:"Acesso de administrador necessário"},{status:403});
  const url = new URL(request.url), period = url.searchParams.get("period") ?? "24";
  const hours = period === "all" ? null : Math.max(1, Math.min(Number(period) || 24, 720));
  const cutoff = hours ? new Date(Date.now() - hours * 36e5) : null;
  const condition = cutoff ? and(eq(jobs.status,"active"),gte(jobs.publishedAt,cutoff)) : eq(jobs.status,"active");
  const rows = await db.select({job:jobs,source:jobSources.name}).from(jobs).leftJoin(jobSources,eq(jobs.sourceId,jobSources.id)).where(condition).orderBy(desc(jobs.publishedAt));
  const pipeline = await db.select().from(userJobStatus).where(eq(userJobStatus.userId,user.userId));
  const byJob = new Map(pipeline.map(item=>[item.jobId,item]));
  const header = ["Data da coleta","Data de publicação","Fonte","Cargo","Empresa","Localização","Modalidade","Senioridade","Tecnologias","Descrição detalhada","Link","Status","Etapa do pipeline","Observações"];
  const lines = rows.map(({job,source})=>{const state=byJob.get(job.id);return [job.firstSeenAt.toISOString(),job.publishedAt?.toISOString()??"",source??"Importação manual",job.title,job.company,job.location,job.workMode,job.seniority,JSON.parse(job.stack||"[]").join(", "),job.description,job.url,job.status,state?.stage??"new",state?.note??""].map(csv).join(";")});
  const body = `\uFEFF${header.map(csv).join(";")}\r\n${lines.join("\r\n")}`;
  return new Response(body,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="radar-vagas-${new Date().toISOString().slice(0,10)}.csv"`,"cache-control":"no-store"}});
}
