import { and,desc,eq,gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../../db/index";
import { alertDeliveries,alertPreferences,jobSources,jobs,profiles } from "../../../../../db/schema";
import { scoreJob } from "../../../../../lib/scoring";

export const dynamic="force-dynamic";
const parse=(value:string)=>{try{return JSON.parse(value) as string[]}catch{return[]}};
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,"0")).join("");
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]??char));

async function authenticate(request:Request){
 const source=(await getDb().select().from(jobSources).where(eq(jobSources.id,"gmail-radarvagas")).limit(1))[0],provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
 if(!source?.enabled||!provided)return null;
 let config:{hash?:string;userId?:string};try{config=JSON.parse(source.externalRef)}catch{return null}
 return config.hash&&config.userId&&await digest(provided)===config.hash?{userId:config.userId}:null;
}

export async function POST(request:Request){
 const owner=await authenticate(request);if(!owner)return NextResponse.json({error:"Não autorizado"},{status:401});
 const body=await request.json().catch(()=>({})) as {action?:string;deliveryId?:string},db=getDb();
 if(body.action==="confirm"){
  if(!body.deliveryId)return NextResponse.json({error:"Entrega obrigatória"},{status:400});
  const delivery=(await db.select().from(alertDeliveries).where(and(eq(alertDeliveries.id,body.deliveryId),eq(alertDeliveries.userId,owner.userId))).limit(1))[0];
  if(!delivery)return NextResponse.json({error:"Entrega não encontrada"},{status:404});
  await db.update(alertDeliveries).set({status:"sent",sentAt:new Date()}).where(eq(alertDeliveries.id,delivery.id));
  return NextResponse.json({ok:true});
 }
 const preference=(await db.select().from(alertPreferences).where(eq(alertPreferences.userId,owner.userId)).limit(1))[0];
 if(!preference?.enabled||preference.frequency!=="daily")return NextResponse.json({send:false,reason:"Resumo diário desativado"});
 const profile=(await db.select().from(profiles).where(eq(profiles.userId,owner.userId)).limit(1))[0];
 if(!profile)return NextResponse.json({send:false,reason:"Perfil não encontrado"});
 const periodKey=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),deliveryId=`daily-email:${owner.userId}:${periodKey}`;
 const existing=(await db.select().from(alertDeliveries).where(eq(alertDeliveries.id,deliveryId)).limit(1))[0];
 if(existing)return NextResponse.json({send:false,reason:existing.status==="sent"?"Resumo já enviado hoje":"Resumo já preparado hoje"});
 const recent=await db.select().from(jobs).where(and(eq(jobs.status,"active"),gte(jobs.publishedAt,new Date(Date.now()-24*36e5)))).orderBy(desc(jobs.publishedAt)).limit(250);
 const matches=recent.map(job=>{const match=scoreJob({title:job.title,description:job.description,stack:parse(job.stack),seniority:job.seniority,workMode:job.workMode,location:job.location,publishedAt:job.publishedAt},{masteredSkills:parse(profile.masteredSkills),desiredAreas:parse(profile.desiredAreas),avoidTerms:parse(profile.avoidTerms),seniority:profile.seniority,preferredMode:profile.preferredMode,cities:parse(profile.cities)});return{...job,score:match.score,reasons:match.reasons}}).filter(job=>job.score>=preference.minScore).sort((a,b)=>b.score-a.score).slice(0,10);
 if(!matches.length)return NextResponse.json({send:false,reason:"Nenhuma vaga atingiu o score mínimo nas últimas 24 horas"});
 await db.insert(alertDeliveries).values({id:deliveryId,userId:owner.userId,channel:"email",periodKey,status:"prepared",jobCount:matches.length,createdAt:new Date(),sentAt:null});
 const name=profile.name?.split(/\s+/)[0]??"candidato",subject=`Radar Carreira: ${matches.length} ${matches.length===1?"vaga compatível":"vagas compatíveis"} hoje`,items=matches.map(job=>`<li style="margin:0 0 18px"><a href="${escape(job.url)}" style="color:#174c3b;font-size:16px;font-weight:700">${escape(job.title)}</a><br><span>${escape(job.company)} · ${job.score}% de aderência</span><br><small>${escape(job.reasons.slice(0,2).join(" · "))}</small></li>`).join(""),html=`<div style="font-family:Arial,sans-serif;color:#17201b;max-width:640px"><p style="color:#527063;font-size:12px;letter-spacing:1px">RADAR CARREIRA · ÚLTIMAS 24 HORAS</p><h1 style="font-size:26px">Olá, ${escape(name)}.</h1><p>Estas são as oportunidades que mais combinam com o seu perfil:</p><ol style="padding-left:24px">${items}</ol><p style="font-size:12px;color:#68746c">Você pode alterar o score mínimo ou desativar este resumo em Meus alertas.</p></div>`,text=[`Olá, ${name}.`,"",...matches.flatMap(job=>[`${job.title} — ${job.company} (${job.score}%)`,job.url,""]),"Altere suas preferências em Meus alertas no Radar Carreira."].join("\n");
 return NextResponse.json({send:true,deliveryId,to:profile.email,subject,html,text,count:matches.length});
}
