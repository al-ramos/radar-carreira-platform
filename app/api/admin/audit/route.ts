import { desc,eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { importRuns,jobEvents,jobs,profiles } from "../../../../db/schema";
export const dynamic="force-dynamic";
const ADMINS=new Set(["contato@amrsolution.com.br","alexsandro.ramos@gmail.com","prof.andreiamr@gmail.com","augustomoreiraramos7@gmail.com"]);
async function admin(){const u=await getChatGPTUser();if(!u)return null;if(ADMINS.has(u.email.toLowerCase()))return u;const p=(await getDb().select({role:profiles.role}).from(profiles).where(eq(profiles.userId,u.userId)).limit(1))[0];return p?.role==="admin"?u:null}
export async function GET(){if(!await admin())return NextResponse.json({error:"Acesso de administrador necessário"},{status:403});const db=getDb(),events=await db.select({id:jobEvents.id,type:jobEvents.type,detail:jobEvents.detail,occurredAt:jobEvents.occurredAt,title:jobs.title,company:jobs.company}).from(jobEvents).leftJoin(jobs,eq(jobEvents.jobId,jobs.id)).orderBy(desc(jobEvents.occurredAt)).limit(60),runs=await db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(30);
 const timeline=[...events.map(e=>({id:`event-${e.id}`,kind:"job",type:e.type,title:e.title??"Vaga",subtitle:e.company??"Empresa não informada",detail:e.detail,date:e.occurredAt})),...runs.map(r=>({id:`run-${r.id}`,kind:"import",type:r.status,title:r.source,subtitle:`${r.inserted} novas · ${r.updated} atualizadas · ${r.errors} erros`,detail:null,date:r.finishedAt??r.startedAt}))].sort((a,b)=>b.date.getTime()-a.date.getTime()).slice(0,80);return NextResponse.json({timeline})}
