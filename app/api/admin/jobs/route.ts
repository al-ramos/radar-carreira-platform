import { inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, triageBatchItems, triageDeduplication, triageHistory } from "../../../../db/schema";
import { can } from "../../../../lib/rbac";
import { deleteJobsAndRelated, purgeArchivedJobsBeforeCutoff } from "../../../../lib/job-deletion";
import { ARCHIVE_BEFORE } from "../../../../lib/job-archive-policy";

export const dynamic="force-dynamic";
const ALL_CONFIRMATION="EXCLUIR TODAS AS VAGAS";
const PURGE_ARCHIVED_CONFIRMATION="EXCLUIR VAGAS ARQUIVADAS ANTERIORES A 15/08/2026";

async function admin(){const user=await getChatGPTUser();if(!user)return null;return await can(user,"jobs.view_stats")?user:null}

export async function GET(){
 if(!await admin())return NextResponse.json({error:"Acesso de administrador necessário"},{status:403});
 const rows=await getDb().select({status:jobs.status}).from(jobs);
 const eligible=await getDb().select({total:sql<number>`count(*)`}).from(jobs).where(
  sql`${jobs.status} = 'archived' and coalesce(${jobs.sourcePublishedAt}, ${jobs.firstSeenAt}) < ${ARCHIVE_BEFORE.getTime()}`,
 );
 return NextResponse.json({total:rows.length,active:rows.filter(job=>job.status==="active").length,closed:rows.filter(job=>job.status!=="active").length,archivedEligibleForPurge:Number(eligible[0]?.total??0)});
}

export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});if(!await can(user,"jobs.delete_all"))return NextResponse.json({error:"Ação reservada ao proprietário da plataforma"},{status:403});
 let payload:{action?:unknown;confirmation?:unknown};try{payload=await request.json()}catch{return NextResponse.json({error:"Envie um comando de exclusão válido"},{status:400})}
 if(payload.action!=="purge_archived_before")return NextResponse.json({error:"Ação de manutenção inválida"},{status:400});
 if(payload.confirmation!==PURGE_ARCHIVED_CONFIRMATION)return NextResponse.json({error:`Para excluir o recorte arquivado, envie confirmation: ${PURGE_ARCHIVED_CONFIRMATION}`},{status:400});
 const deleted=await purgeArchivedJobsBeforeCutoff();
 return NextResponse.json({ok:true,deleted,scope:"archived_before_2026_08_15",cutoff:ARCHIVE_BEFORE.toISOString()});
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
