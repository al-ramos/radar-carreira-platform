import { eq } from "drizzle-orm";
import { getDb } from "../../../../db/index";
import { importRuns,jobSources,jobs } from "../../../../db/schema";
import { jobsFromEmail,type RadarEmail } from "../../../../lib/email-jobs";
import { fingerprint } from "../../../../lib/jobs";

export const dynamic="force-dynamic";
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,"0")).join("");
export async function POST(request:Request){
  const provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"",db=getDb(),source=(await db.select().from(jobSources).where(eq(jobSources.id,"gmail-radarvagas")).limit(1))[0];
  if(!source||!provided||await digest(provided)!==source.externalRef)return Response.json({error:"Não autorizado"},{status:401});
  const payload=await request.json() as {label?:string;messages?:RadarEmail[]};
  if(payload.label!=="RadarVagas"||!Array.isArray(payload.messages))return Response.json({error:"Etiqueta RadarVagas obrigatória"},{status:400});
  const imported=payload.messages.flatMap(jobsFromEmail),runId=crypto.randomUUID(),now=new Date();
  await db.insert(importRuns).values({id:runId,source:"Gmail/RadarVagas",status:"running",received:payload.messages.length,actorUserId:"gmail-bridge",startedAt:now});
  let inserted=0,updated=0;
  for(const job of imported){const fp=fingerprint(job),existing=(await db.select({id:jobs.id}).from(jobs).where(eq(jobs.fingerprint,fp)).limit(1))[0],values={id:existing?.id??crypto.randomUUID(),fingerprint:fp,sourceId:null,externalId:job.externalId??null,company:job.company,title:job.title,seniority:null,workMode:job.workMode??null,location:job.location??null,stack:"[]",publishedAt:job.publishedAt?new Date(job.publishedAt):now,url:job.url,description:job.description??"",firstSeenAt:now,lastSeenAt:now,status:"active" as const,createdAt:now,updatedAt:now};await db.insert(jobs).values(values).onConflictDoUpdate({target:jobs.fingerprint,set:{lastSeenAt:now,publishedAt:values.publishedAt,url:values.url,status:"active",updatedAt:now}});if(existing)updated++;else inserted++}
  await db.update(importRuns).set({status:"completed",inserted,updated,finishedAt:new Date()}).where(eq(importRuns.id,runId));
  return Response.json({ok:true,emails:payload.messages.length,jobs:imported.length,inserted,updated,ignored:payload.messages.length-imported.length});
}
