import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { importRuns, jobs } from "../db/schema";
import { fingerprint, validJob, type ImportedJob } from "./jobs";

export type ImportResult={ok:true;runId:string;received:number;inserted:number;updated:number;errors:number};

export async function persistImportedJobs(items:ImportedJob[],options:{source:string;actorUserId:string}):Promise<ImportResult>{
 const runId=crypto.randomUUID(),db=getDb(),startedAt=new Date();
 await db.insert(importRuns).values({id:runId,source:options.source,status:"running",received:items.length,actorUserId:options.actorUserId,startedAt});
 let inserted=0,updated=0,errors=0;
 try{
  for(const item of items){
   if(!validJob(item)){errors++;continue}
   const job=item as ImportedJob,fp=fingerprint(job),now=new Date(),existing=(await db.select({id:jobs.id}).from(jobs).where(eq(jobs.fingerprint,fp)).limit(1))[0];
   const values={id:existing?.id??crypto.randomUUID(),fingerprint:fp,sourceId:job.sourceId??null,externalId:job.externalId??null,company:job.company.trim(),title:job.title.trim(),seniority:job.seniority??null,workMode:job.workMode??null,location:job.location??null,stack:JSON.stringify(job.stack??[]),publishedAt:job.publishedAt?new Date(job.publishedAt):null,url:job.url,description:job.description??"",firstSeenAt:now,lastSeenAt:now,status:"active" as const,createdAt:now,updatedAt:now};
   await db.insert(jobs).values(values).onConflictDoUpdate({target:jobs.fingerprint,set:{company:values.company,title:values.title,seniority:values.seniority,workMode:values.workMode,location:values.location,stack:values.stack,publishedAt:values.publishedAt,url:values.url,description:values.description,lastSeenAt:now,status:"active",updatedAt:now}});
   existing?updated++:inserted++;
  }
  await db.update(importRuns).set({status:"completed",inserted,updated,errors,duplicates:0,finishedAt:new Date()}).where(eq(importRuns.id,runId));
  return{ok:true,runId,received:items.length,inserted,updated,errors};
 }catch(error){
  await db.update(importRuns).set({status:"failed",inserted,updated,errors:errors+1,finishedAt:new Date()}).where(eq(importRuns.id,runId));
  throw error;
 }
}
