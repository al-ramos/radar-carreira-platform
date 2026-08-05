import { NextResponse } from "next/server";
import { normalizeImportedJobs } from "../../../../lib/import-jobs";
import { validLinkedInCollectorSecret } from "../../../../lib/linkedin-collector-auth";
import { persistImportedJobs } from "../../../../lib/persist-imported-jobs";

export const dynamic="force-dynamic";
const CORS={"access-control-allow-origin":"*","access-control-allow-headers":"authorization, content-type","access-control-allow-methods":"POST, OPTIONS","cache-control":"no-store"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:CORS});

export async function OPTIONS(){return new Response(null,{status:204,headers:CORS})}

export async function POST(request:Request){
 const provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";
 if(!await validLinkedInCollectorSecret(provided))return json({error:"Chave do coletor inválida"},401);
 const text=await request.text();
 if(text.length>2_000_000)return json({error:"A importação excede 2 MB"},413);
 let value:unknown;
 try{value=JSON.parse(text)}catch{return json({error:"JSON inválido"},400)}
 if(value&&typeof value==="object"&&(value as {action?:unknown}).action==="test")return json({ok:true,message:"Conexão com o Radar confirmada"});
 const rows=Array.isArray(value)?value:value&&typeof value==="object"&&(value as {jobs?:unknown}).jobs;
 const items=normalizeImportedJobs(Array.isArray(rows)?rows:[]);
 if(!items.length)return json({error:"Nenhuma vaga válida foi recebida"},400);
 if(items.length>2000)return json({error:"O limite é de 2.000 vagas por importação"},400);
 try{return json(await persistImportedJobs(items,{source:"linkedin-extension",actorUserId:"linkedin-extension"}))}
 catch{return json({error:"Não foi possível gravar as vagas"},500)}
}
