import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobEvents,jobs,profiles } from "../../../../db/schema";

export const dynamic="force-dynamic";

const parse=(value:string)=>{try{return JSON.parse(value) as string[]}catch{return[]}};
const clean=(value:string)=>value
  .replace(/<br\s*\/?>/gi,"\n")
  .replace(/<\/p>|<\/li>|<\/div>|<\/h\d>/gi,"\n")
  .replace(/<li[^>]*>/gi,"• ")
  .replace(/<[^>]+>/g," ")
  .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'")
  .replace(/[ \t]+/g," ").replace(/\n\s*\n\s*\n+/g,"\n\n").trim();

function findPosting(value:unknown):Record<string,unknown>|null{
  if(Array.isArray(value)){for(const item of value){const found=findPosting(item);if(found)return found}return null}
  if(!value||typeof value!=="object")return null;
  const row=value as Record<string,unknown>,type=row["@type"];
  if(type==="JobPosting"||(Array.isArray(type)&&type.includes("JobPosting")))return row;
  return findPosting(row["@graph"]);
}

async function descriptionFromLinkedIn(url:string){
  try{
    const parsed=new URL(url);
    if(parsed.protocol!=="https:"||!(parsed.hostname==="linkedin.com"||parsed.hostname.endsWith(".linkedin.com")))return null;
    const response=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; RadarCarreira/1.0)",accept:"text/html"},signal:AbortSignal.timeout(8000)});
    if(!response.ok)return null;
    const html=await response.text();
    for(const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
      try{const posting=findPosting(JSON.parse(match[1]));const description=posting?.description;if(typeof description==="string"){const text=clean(description);if(text.length>80)return text.slice(0,16000)}}catch{}
    }
  }catch{}
  return null;
}

function draft(name:string,title:string,company:string,seniority:string|null,mode:string|null,skills:string[],description:string){
  const firstName=name.trim().split(/\s+/)[0]||"Olá";
  const text=`${title} ${description}`.toLowerCase();
  const matches=skills.filter(skill=>text.includes(skill.toLowerCase())).slice(0,5);
  const strengths=matches.length?matches:skills.slice(0,3);
  const experience=strengths.length?` Tenho experiência com ${strengths.join(", ")}, competências que podem contribuir diretamente para os desafios da posição.`:" Meu perfil está alinhado aos desafios e responsabilidades apresentados para a posição.";
  const context=[seniority,mode].filter(Boolean).join(" e ");
  return `Olá,\n\nTenho interesse na oportunidade de ${title} na ${company}.${context?` Atuo em nível ${context}.`:""}${experience}\n\nGostaria de conversar para entender melhor os desafios da vaga e compartilhar como minha experiência pode contribuir com o time.\n\nAtenciosamente,\n${firstName}`;
}

export async function POST(request:Request){
  const user=await getChatGPTUser();
  if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});
  const body=await request.json().catch(()=>({})) as {jobId?:string};
  if(!body.jobId)return NextResponse.json({error:"Vaga obrigatória"},{status:400});
  const db=getDb(),job=(await db.select().from(jobs).where(eq(jobs.id,body.jobId)).limit(1))[0];
  if(!job)return NextResponse.json({error:"Vaga não encontrada"},{status:404});
  const profile=(await db.select().from(profiles).where(eq(profiles.userId,user.userId)).limit(1))[0];
  let description=job.description,source=description.length>80&&!description.startsWith("Importada do alerta RadarVagas:")?"stored":"alert";
  if(source==="alert"){
    const official=await descriptionFromLinkedIn(job.url);
    if(official){description=official;source="linkedin";await db.update(jobs).set({description,updatedAt:new Date()}).where(eq(jobs.id,job.id));await db.insert(jobEvents).values({jobId:job.id,type:"linkedin_description",detail:"Descrição oficial obtida na página pública da vaga.",occurredAt:new Date()})}
  }
  const skills=profile?parse(profile.masteredSkills):parse(job.stack),name=profile?.name||user.fullName||user.displayName||"Candidato";
  return NextResponse.json({description,descriptionSource:source,subject:`Candidatura — ${job.title} | ${name}`,message:draft(name,job.title,job.company,profile?.seniority??null,profile?.preferredMode??job.workMode,skills,description)});
}
