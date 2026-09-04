import { and,eq,isNotNull,lt,ne } from "drizzle-orm";
import { getDb } from "../db/index";
import { jobEvents,jobs,platformSettings } from "../db/schema";
import { deleteJobsAndRelated } from "./job-deletion";
/**
 * A reconciliação lia `select().from(jobs)` — todas as colunas de todas as
 * vagas, descrição inclusive. Com 15 mil vagas num banco de ~200 MB, o
 * isolate estourava a memória e a rota devolvia 503; a coleta diária ficou
 * vermelha por dias por causa disso. Aqui só entram as três colunas que a
 * decisão usa, e as arquivadas — mais da metade do acervo — são descartadas
 * no SQL, não no laço.
 */
export async function reconcileJobLifecycle(){const db=getDb(),config=(await db.select().from(platformSettings).where(eq(platformSettings.id,"global")).limit(1))[0],staleDays=config?.staleAfterDays??7,retentionDays=config?.retentionDays??180,now=Date.now(),rows=await db.select({id:jobs.id,status:jobs.status,lastSeenAt:jobs.lastSeenAt}).from(jobs).where(and(isNotNull(jobs.sourceId),ne(jobs.status,"archived")));let possiblyClosed=0,closed=0,reactivated=0;for(const job of rows){const ageDays=(now-job.lastSeenAt.getTime())/864e5;let next=job.status;if(ageDays>=staleDays*2)next="closed";else if(ageDays>=staleDays)next="possibly_closed";else if(job.status!=="active")next="active";if(next===job.status)continue;await db.update(jobs).set({status:next as "active"|"possibly_closed"|"closed",updatedAt:new Date()}).where(eq(jobs.id,job.id));await db.insert(jobEvents).values({jobId:job.id,type:next==="active"?"reactivated":next,detail:JSON.stringify({previous:job.status,ageDays:Math.floor(ageDays),thresholdDays:staleDays}),occurredAt:new Date()});if(next==="possibly_closed")possiblyClosed++;else if(next==="closed")closed++;else reactivated++}const expired=await db.select({id:jobs.id}).from(jobs).where(and(eq(jobs.status,"closed"),lt(jobs.updatedAt,new Date(now-retentionDays*864e5))));const deleted=await deleteJobsAndRelated(expired.map(job=>job.id));return{checked:rows.length,possiblyClosed,closed,reactivated,deleted,staleDays,retentionDays}}
