import { eq,inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { alertReads,jobEvents,jobs,profiles,userJobStatus } from "../../../../db/schema";

export const dynamic="force-dynamic";
const ADMINS=new Set(["contato@amrsolution.com.br","alexsandro.ramos@gmail.com","prof.andreiamr@gmail.com"]);
const OWNER_EMAIL="alexsandro.ramos@gmail.com";
const ALL_CONFIRMATION="EXCLUIR TODAS AS VAGAS";

async function admin(){const user=await getChatGPTUser();if(!user)return null;if(ADMINS.has(user.email.toLowerCase()))return user;const profile=(await getDb().select({role:profiles.role}).from(profiles).where(eq(profiles.userId,user.userId)).limit(1))[0];return profile?.role==="admin"?user:null}

export async function GET(){
 if(!await admin())return NextResponse.json({error:"Acesso de administrador necessário"},{status:403});
 const rows=await getDb().select({status:jobs.status}).from(jobs);
 return NextResponse.json({total:rows.length,active:rows.filter(job=>job.status==="active").length,closed:rows.filter(job=>job.status!=="active").length});
}

export async function DELETE(request:Request){
 const user=await getChatGPTUser();if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});if(user.email.toLowerCase()!==OWNER_EMAIL)return NextResponse.json({error:"Ação reservada ao proprietário da plataforma"},{status:403});
 let payload:{jobIds?:unknown;all?:unknown;confirmation?:unknown};try{payload=await request.json()}catch{return NextResponse.json({error:"Envie um comando de exclusão válido"},{status:400})}
 const db=getDb(),all=payload.all===true,ids=Array.isArray(payload.jobIds)?[...new Set(payload.jobIds.filter((id):id is string=>typeof id==="string"&&id.length>0))]:[];
 if(all&&payload.confirmation!==ALL_CONFIRMATION)return NextResponse.json({error:`Para excluir todas as vagas, envie confirmation: ${ALL_CONFIRMATION}`},{status:400});
 if(!all&&!ids.length)return NextResponse.json({error:"Informe jobIds ou all: true"},{status:400});
 const target=all?await db.select({id:jobs.id}).from(jobs):await db.select({id:jobs.id}).from(jobs).where(inArray(jobs.id,ids));
 if(!target.length)return NextResponse.json({ok:true,deleted:0});
 const targetIds=target.map(job=>job.id);
 await db.delete(alertReads).where(inArray(alertReads.jobId,targetIds));
 await db.delete(userJobStatus).where(inArray(userJobStatus.jobId,targetIds));
 await db.delete(jobEvents).where(inArray(jobEvents.jobId,targetIds));
 await db.delete(jobs).where(inArray(jobs.id,targetIds));
 return NextResponse.json({ok:true,deleted:targetIds.length,scope:all?"all":"selected"});
}
