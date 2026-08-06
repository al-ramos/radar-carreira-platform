import { NextResponse } from "next/server";
import { normalizeImportedJobs } from "../../../../lib/import-jobs";
import { authenticateLinkedInCollectorSecret } from "../../../../lib/linkedin-collector-auth";
import { persistImportedJobs } from "../../../../lib/persist-imported-jobs";
import { filterImportedJobsByProfile } from "../../../../lib/collector-profile-filter";
import { getDb } from "../../../../db/index";
import { profiles } from "../../../../db/schema";
import { eq } from "drizzle-orm";

export const dynamic="force-dynamic";
const CORS={"access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type","access-control-allow-methods":"POST, OPTIONS","cache-control":"no-store"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:CORS});

export async function OPTIONS(){return new Response(null,{status:204,headers:CORS})}

export async function POST(request:Request){
 const provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";
 const identity=await authenticateLinkedInCollectorSecret(provided);
 if(!identity)return json({error:"Chave do coletor inválida"},401);
 const text=await request.text();
 if(text.length>2_000_000)return json({error:"A importação excede 2 MB"},413);
 let value:unknown;
 try{value=JSON.parse(text)}catch{return json({error:"JSON inválido"},400)}
 if(value&&typeof value==="object"&&(value as {action?:unknown}).action==="test")return json({ok:true,message:"Conexão com o Radar confirmada"});
 const rows=Array.isArray(value)?value:value&&typeof value==="object"&&(value as {jobs?:unknown}).jobs;
 const items=normalizeImportedJobs(Array.isArray(rows)?rows:[]);
 if(!items.length)return json({error:"Nenhuma vaga válida foi recebida"},400);
 if(items.length>2000)return json({error:"O limite é de 2.000 vagas por importação"},400);
 let accepted=items,rejected=0,requiredStacks:string[]=[] as string[],stackMatchMode:"all"|"any"="all";
 if(identity.userId){
  const profile=(await getDb().select({requiredStacks:profiles.requiredStacks,stackMatchMode:profiles.stackMatchMode}).from(profiles).where(eq(profiles.userId,identity.userId)).limit(1))[0];
  if(profile){
   let configured:string[]=[];try{configured=JSON.parse(profile.requiredStacks) as string[]}catch{}
   const filtered=filterImportedJobsByProfile(items,{requiredStacks:configured,stackMatchMode:profile.stackMatchMode==="any"?"any":"all"});
   accepted=filtered.accepted;rejected=filtered.rejected;requiredStacks=filtered.requiredStacks;stackMatchMode=filtered.stackMatchMode;
  }
 }
 if(!accepted.length)return json({ok:true,received:items.length,accepted:0,rejected,inserted:0,updated:0,errors:0,requiredStacks,stackMatchMode,message:"Nenhuma vaga atende ao perfil de stacks obrigatórias"});
 try{return json({...await persistImportedJobs(accepted,{source:"linkedin-extension",actorUserId:identity.userId??"linkedin-extension"}),accepted:accepted.length,rejected,requiredStacks,stackMatchMode})}
 catch{return json({error:"Não foi possível gravar as vagas"},500)}
}
