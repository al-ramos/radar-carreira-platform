import { inArray,lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs } from "../../../../db/schema";
import { can } from "../../../../lib/rbac";
import { deleteJobsAndRelated } from "../../../../lib/job-deletion";

export const dynamic="force-dynamic";
const ALL_CONFIRMATION="EXCLUIR TODAS AS VAGAS";

function cutoffDate(value:unknown){
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const date=new Date(`${value}T00:00:00.000Z`);
 return Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value?null:date;
}
function cutoffConfirmation(before:string){return `EXCLUIR VAGAS ANTERIORES A ${before}`}

async function admin(){const user=await getChatGPTUser();if(!user)return null;return await can(user,"jobs.view_stats")?user:null}

export async function GET(request:Request){
 if(!await admin())return NextResponse.json({error:"Acesso de administrador necessário"},{status:403});
 const db=getDb(),beforeText=new URL(request.url).searchParams.get("before");
 if(beforeText!==null){const before=cutoffDate(beforeText);if(!before)return NextResponse.json({error:"Informe uma data de corte válida."},{status:400});const selected=await db.select({id:jobs.id}).from(jobs).where(lt(jobs.firstSeenAt,before));return NextResponse.json({before:beforeText,selected:selected.length})}
 const rows=await db.select({status:jobs.status}).from(jobs);
 return NextResponse.json({total:rows.length,active:rows.filter(job=>job.status==="active").length,closed:rows.filter(job=>job.status!=="active").length});
}

export async function DELETE(request:Request){
 const user=await getChatGPTUser();if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});if(!await can(user,"jobs.delete_all"))return NextResponse.json({error:"Ação reservada ao proprietário da plataforma"},{status:403});
 let payload:{jobIds?:unknown;all?:unknown;before?:unknown;confirmation?:unknown};try{payload=await request.json()}catch{return NextResponse.json({error:"Envie um comando de exclusão válido"},{status:400})}
 const db=getDb(),all=payload.all===true,ids=Array.isArray(payload.jobIds)?[...new Set(payload.jobIds.filter((id):id is string=>typeof id==="string"&&id.length>0))]:[],beforeText=typeof payload.before==="string"?payload.before:null,before=beforeText?cutoffDate(beforeText):null;
 if(beforeText!==null&&!before)return NextResponse.json({error:"Informe uma data de corte válida."},{status:400});
 if([all,before!==null,ids.length>0].filter(Boolean).length!==1)return NextResponse.json({error:"Escolha exatamente um escopo de exclusão."},{status:400});
 if(all&&payload.confirmation!==ALL_CONFIRMATION)return NextResponse.json({error:`Para excluir todas as vagas, envie confirmation: ${ALL_CONFIRMATION}`},{status:400});
 if(before&&payload.confirmation!==cutoffConfirmation(beforeText!))return NextResponse.json({error:`Para excluir as vagas selecionadas, envie confirmation: ${cutoffConfirmation(beforeText!)}`},{status:400});
 const target=all?await db.select({id:jobs.id}).from(jobs):before?await db.select({id:jobs.id}).from(jobs).where(lt(jobs.firstSeenAt,before)):await db.select({id:jobs.id}).from(jobs).where(inArray(jobs.id,ids));
 if(!target.length)return NextResponse.json({ok:true,deleted:0});
 const targetIds=target.map(job=>job.id);
 await deleteJobsAndRelated(targetIds);
 return NextResponse.json({ok:true,deleted:targetIds.length,scope:all?"all":before?"before":"selected",before:beforeText});
}
