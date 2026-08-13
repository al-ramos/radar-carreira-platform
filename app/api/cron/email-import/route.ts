import { and,desc,eq,like,or } from "drizzle-orm";
import { getDb } from "../../../../db/index";
import { importRuns,jobEvents,jobSources,jobs,userJobStatus } from "../../../../db/schema";
import { applicationFromEmail,jobsFromEmail,type RadarEmail } from "../../../../lib/email-jobs";
import { fingerprint } from "../../../../lib/jobs";
import { enrichLinkedInJobs } from "../../../../lib/enrichment";
import { inferJobArea } from "../../../../lib/job-area";
import { recordImportRunJobs } from "../../../../lib/import-tracking";

export const dynamic="force-dynamic";
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,"0")).join("");
export async function POST(request:Request){
  const provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"",db=getDb(),source=(await db.select().from(jobSources).where(eq(jobSources.id,"gmail-radarvagas")).limit(1))[0];
  let config:{hash:string;userId:string}|null=null;try{config=source?JSON.parse(source.externalRef):null}catch{config=null}
  if(!config||!provided||await digest(provided)!==config.hash)return Response.json({error:"Não autorizado"},{status:401});
  const payload=await request.json() as {label?:string;messages?:RadarEmail[]};
  if(payload.label!=="RadarVagas"||!Array.isArray(payload.messages))return Response.json({error:"Etiqueta RadarVagas obrigatória"},{status:400});
  const imported=payload.messages.flatMap(jobsFromEmail),runId=crypto.randomUUID(),now=new Date();
  await db.insert(importRuns).values({id:runId,source:"Gmail/RadarVagas",sourceId:"gmail-radarvagas",channel:"email",status:"running",received:payload.messages.length,actorUserId:config.userId,startedAt:now});
  let inserted=0,updated=0,events=0;
  for(const job of imported){
    const fp=fingerprint(job),identity=job.externalId?or(eq(jobs.externalId,job.externalId),eq(jobs.fingerprint,fp)):eq(jobs.fingerprint,fp);
    const existing=(await db.select({id:jobs.id}).from(jobs).where(identity).limit(1))[0];
    const values={
      id:existing?.id??crypto.randomUUID(),fingerprint:fp,sourceId:"gmail-radarvagas",externalId:job.externalId??null,
      company:job.company,title:job.title,seniority:null,workMode:job.workMode??null,location:job.location??null,stack:"[]",
      publishedAt:job.publishedAt?new Date(job.publishedAt):now,sourcePublishedAt:null,
      ingestionMode:"automatic" as const,ingestionChannel:"email" as const,roleArea:inferJobArea(job),url:job.url,description:job.description??"",firstSeenAt:now,lastSeenAt:now,
      status:"active" as const,createdAt:now,updatedAt:now,
    };
    if(existing){
      await db.update(jobs).set({fingerprint:fp,externalId:values.externalId,company:values.company,title:values.title,workMode:values.workMode,location:values.location,publishedAt:values.publishedAt,ingestionChannel:values.ingestionChannel,roleArea:values.roleArea,url:values.url,description:values.description,lastSeenAt:now,status:"active",updatedAt:now}).where(eq(jobs.id,existing.id));
      updated++;
    }else{
      await db.insert(jobs).values(values);inserted++;
    }
    await recordImportRunJobs(db,runId,[fp],new Set(existing?[fp]:[]),now);
  }
  for(const email of payload.messages){const signal=applicationFromEmail(email);if(!signal)continue;const condition=signal.title&&signal.company?and(like(jobs.title,`%${signal.title}%`),like(jobs.company,`%${signal.company}%`)):signal.title?like(jobs.title,`%${signal.title}%`):signal.company?like(jobs.company,`%${signal.company}%`):null;if(!condition)continue;const matches=await db.select({id:jobs.id}).from(jobs).where(condition).orderBy(desc(jobs.updatedAt)).limit(2);if(matches.length!==1)continue;const jobId=matches[0].id;await db.insert(userJobStatus).values({userId:config.userId,jobId,stage:signal.stage,note:signal.detail,updatedAt:new Date(email.date)}).onConflictDoUpdate({target:[userJobStatus.userId,userJobStatus.jobId],set:{stage:signal.stage,note:signal.detail,updatedAt:new Date(email.date)}});await db.insert(jobEvents).values({jobId,type:signal.type,detail:signal.detail,occurredAt:new Date(email.date)});events++}
  await db.update(importRuns).set({status:"completed",inserted,updated,finishedAt:new Date()}).where(eq(importRuns.id,runId));
  const enriched=await enrichLinkedInJobs();
  return Response.json({ok:true,emails:payload.messages.length,jobs:imported.length,inserted,updated,pipelineEvents:events,enriched});
}
