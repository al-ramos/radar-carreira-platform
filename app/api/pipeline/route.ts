import { desc,eq,and } from "drizzle-orm";import { NextResponse } from "next/server";import { getChatGPTUser } from "../../chatgpt-auth";import { getDb } from "../../../db/index";import { jobs,userJobStatus } from "../../../db/schema";
// "viewed" é o estágio de entrada automático ao abrir uma vaga; os demais são ações explícitas do usuário.
// "offer" e "new" mantidos apenas para compatibilidade com dados antigos — não aparecem na UI.
const VALID_STAGES=new Set(["viewed","saved","applied","interview","rejected","archived","offer","new"]);
export const dynamic="force-dynamic";
export async function GET(){const user=await getChatGPTUser();if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});const rows=await getDb().select({job:jobs,stage:userJobStatus.stage,note:userJobStatus.note,updatedAt:userJobStatus.updatedAt}).from(userJobStatus).innerJoin(jobs,eq(jobs.id,userJobStatus.jobId)).where(eq(userJobStatus.userId,user.userId)).orderBy(desc(userJobStatus.updatedAt));return NextResponse.json({items:rows.map(r=>({...r.job,stack:JSON.parse(r.job.stack||"[]"),stage:r.stage,note:r.note,pipelineUpdatedAt:r.updatedAt}))})}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});
 const body=await request.json() as {jobId?:string;stage?:string;note?:string};
 if(!body.jobId||!body.stage||!VALID_STAGES.has(body.stage))return NextResponse.json({error:"Dados inválidos"},{status:400});
 const stage=body.stage as "viewed"|"saved"|"applied"|"interview"|"rejected"|"archived";
 const values={userId:user.userId,jobId:body.jobId,stage,note:body.note??null,updatedAt:new Date()};
 if(stage==="viewed"){
   // Visualização: registra apenas se a vaga ainda não está no pipeline (não rebaixa estágios mais avançados)
   await getDb().insert(userJobStatus).values(values).onConflictDoNothing();
 } else {
   await getDb().insert(userJobStatus).values(values).onConflictDoUpdate({target:[userJobStatus.userId,userJobStatus.jobId],set:{stage:values.stage,note:values.note,updatedAt:values.updatedAt}});
 }
 return NextResponse.json({ok:true,stage:values.stage});
}
export async function DELETE(request:Request){const user=await getChatGPTUser();if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});const body=await request.json() as {jobId?:string};if(!body.jobId)return NextResponse.json({error:"ID inválido"},{status:400});await getDb().delete(userJobStatus).where(and(eq(userJobStatus.userId,user.userId),eq(userJobStatus.jobId,body.jobId)));return NextResponse.json({ok:true})}
