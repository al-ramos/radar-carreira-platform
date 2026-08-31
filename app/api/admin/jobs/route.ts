import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, triageBatchItems, triageDeduplication, triageHistory, userJobStatus } from "../../../../db/schema";
import { can } from "../../../../lib/rbac";
import { deleteJobsAndRelated, purgeJobsByStatusBeforeCutoff, type PurgeableJobStatus } from "../../../../lib/job-deletion";
import { ARCHIVE_BEFORE } from "../../../../lib/job-archive-policy";

export const dynamic="force-dynamic";
const ALL_CONFIRMATION="EXCLUIR TODAS AS VAGAS";
const DATE_PATTERN=/^\d{4}-\d{2}-\d{2}$/;
function archivedCutoff(value:string|null){
 if(!value||!DATE_PATTERN.test(value))return null;
 const [year,month,day]=value.split("-").map(Number),calendarDate=new Date(Date.UTC(year,month-1,day));
 if(calendarDate.getUTCFullYear()!==year||calendarDate.getUTCMonth()!==month-1||calendarDate.getUTCDate()!==day)return null;
 return new Date(`${value}T00:00:00-03:00`);
}
function purgeableStatus(value:unknown):PurgeableJobStatus|null{return value==="archived"||value==="possibly_closed"||value==="closed"?value:null;}

async function admin(){const user=await getChatGPTUser();if(!user)return null;return await can(user,"jobs.view_stats")?user:null}

export async function GET(request:Request){
 const user=await admin();if(!user)return NextResponse.json({error:"Acesso de administrador necessário"},{status:403});
 const params=new URL(request.url).searchParams,requestedDate=params.get("archivedBefore"),requestedViewedDate=params.get("viewedBefore"),cutoff=requestedDate?archivedCutoff(requestedDate):ARCHIVE_BEFORE,viewedCutoff=requestedViewedDate?archivedCutoff(requestedViewedDate):cutoff;
 if(!cutoff||!viewedCutoff)return NextResponse.json({error:"Informe datas válidas para os recortes."},{status:400});
 const db=getDb(),[statusRows,eligible,possiblyClosed,closed,viewed]=await Promise.all([
  db.select({status:jobs.status,total:sql<number>`count(*)`}).from(jobs).groupBy(jobs.status),
  db.select({total:sql<number>`count(*)`}).from(jobs).where(
  sql`${jobs.status} = 'archived' and coalesce(${jobs.sourcePublishedAt}, ${jobs.firstSeenAt}) < ${cutoff.getTime()}`,
  ),
  db.select({total:sql<number>`count(*)`}).from(jobs).where(
  sql`${jobs.status} = 'possibly_closed' and coalesce(${jobs.sourcePublishedAt}, ${jobs.firstSeenAt}) < ${cutoff.getTime()}`,
  ),
  db.select({total:sql<number>`count(*)`}).from(jobs).where(
   sql`${jobs.status} = 'closed' and coalesce(${jobs.sourcePublishedAt}, ${jobs.firstSeenAt}) < ${cutoff.getTime()}`,
  ),
  db.select({total:sql<number>`count(*)`}).from(userJobStatus).where(and(eq(userJobStatus.userId,user.userId),eq(userJobStatus.stage,"viewed"),lt(userJobStatus.updatedAt,viewedCutoff))),
 ]);
 const statusCount=(status:typeof statusRows[number]["status"])=>Number(statusRows.find(row=>row.status===status)?.total??0),total=statusRows.reduce((sum,row)=>sum+Number(row.total),0);
 return NextResponse.json({total,active:statusCount("active"),possiblyClosed:statusCount("possibly_closed"),closed:statusCount("closed"),archived:statusCount("archived"),archivedEligibleForPurge:Number(eligible[0]?.total??0),possiblyClosedEligibleForPurge:Number(possiblyClosed[0]?.total??0),closedEligibleForPurge:Number(closed[0]?.total??0),viewedEligibleForArchive:Number(viewed[0]?.total??0),archivedBefore:cutoff.toISOString(),viewedBefore:viewedCutoff.toISOString()});
}

export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});if(!await can(user,"jobs.delete_all"))return NextResponse.json({error:"Ação reservada ao proprietário da plataforma"},{status:403});
 let payload:{action?:unknown;archivedBefore?:unknown;viewedBefore?:unknown;status?:unknown};try{payload=await request.json()}catch{return NextResponse.json({error:"Envie um comando de exclusão válido"},{status:400})}
 const requestedCutoff=payload.action==="archive_viewed_before"?payload.viewedBefore:payload.archivedBefore,cutoff=archivedCutoff(typeof requestedCutoff==="string"?requestedCutoff:"");
 if(!cutoff)return NextResponse.json({error:"Informe uma data válida para o recorte."},{status:400});
 if(payload.action==="archive_viewed_before"){
  const condition=and(eq(userJobStatus.userId,user.userId),eq(userJobStatus.stage,"viewed"),lt(userJobStatus.updatedAt,cutoff)),count=await getDb().select({total:sql<number>`count(*)`}).from(userJobStatus).where(condition),archived=Number(count[0]?.total??0);
  if(archived)await getDb().update(userJobStatus).set({stage:"archived",updatedAt:new Date()}).where(condition);
  return NextResponse.json({ok:true,archived,scope:"viewed_before",cutoff:cutoff.toISOString()});
 }
 if(payload.action!=="purge_archived_before")return NextResponse.json({error:"Ação de manutenção inválida"},{status:400});
 const status=purgeableStatus(payload.status);
 if(!status)return NextResponse.json({error:"Escolha Arquivadas, Possivelmente encerradas ou Encerradas."},{status:400});
 const deleted=await purgeJobsByStatusBeforeCutoff(status,cutoff);
 return NextResponse.json({ok:true,deleted,scope:`${status}_before`,cutoff:cutoff.toISOString()});
}

export async function DELETE(request:Request){
 const user=await getChatGPTUser();if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});if(!await can(user,"jobs.delete_all"))return NextResponse.json({error:"Ação reservada ao proprietário da plataforma"},{status:403});
 let payload:{jobIds?:unknown;all?:unknown;confirmation?:unknown};try{payload=await request.json()}catch{return NextResponse.json({error:"Envie um comando de exclusão válido"},{status:400})}
 const db=getDb(),all=payload.all===true,ids=Array.isArray(payload.jobIds)?[...new Set(payload.jobIds.filter((id):id is string=>typeof id==="string"&&id.length>0))]:[];
 if(all&&payload.confirmation!==ALL_CONFIRMATION)return NextResponse.json({error:`Para excluir todas as vagas, envie confirmation: ${ALL_CONFIRMATION}`},{status:400});
 if(!all&&!ids.length)return NextResponse.json({error:"Informe jobIds ou all: true"},{status:400});
 const target=all?await db.select({id:jobs.id}).from(jobs):await db.select({id:jobs.id}).from(jobs).where(inArray(jobs.id,ids));
 if(!target.length)return NextResponse.json({ok:true,deleted:0});
 const targetIds=target.map(job=>job.id);
 // Histórico é evidência operacional. A exclusão física não pode apagar nem
 // deixar parcialmente apagada uma vaga já colocada em qualquer fila.
 const dependencies=await Promise.all([
  db.select({id:triageHistory.id}).from(triageHistory).where(inArray(triageHistory.jobId,targetIds)).limit(1),
  db.select({id:draftOutbox.id}).from(draftOutbox).where(inArray(draftOutbox.jobId,targetIds)).limit(1),
  db.select({jobId:triageBatchItems.jobId}).from(triageBatchItems).where(inArray(triageBatchItems.jobId,targetIds)).limit(1),
  db.select({key:triageDeduplication.idempotencyKey}).from(triageDeduplication).where(inArray(triageDeduplication.jobId,targetIds)).limit(1),
 ]);
 if(dependencies.some(rows=>rows.length))return NextResponse.json({error:"Exclusão bloqueada: há histórico de triagem ou rascunho vinculado. Arquive a vaga para removê-la da operação sem perder evidências."},{status:409});
 await deleteJobsAndRelated(targetIds);
 return NextResponse.json({ok:true,deleted:targetIds.length,scope:all?"all":"selected"});
}
