import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobEvents,jobs,profiles } from "../../../../db/schema";
import { inferTechnologyStack } from "../../../../lib/technology-stack";
import { allowedWorkModes, listFromStored } from "../../../../lib/profile-options";
import { isTechnologyJob, scoreJob } from "../../../../lib/scoring";

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

export async function POST(request:Request){
  const user=await getChatGPTUser();
  if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});
  const body=await request.json().catch(()=>({})) as {jobId?:string};
  if(!body.jobId)return NextResponse.json({error:"Vaga obrigatória"},{status:400});
  const db=getDb();
  const [job,profile]=await Promise.all([
    db.select().from(jobs).where(eq(jobs.id,body.jobId)).limit(1).then(rows=>rows[0]),
    db.select().from(profiles).where(eq(profiles.userId,user.userId)).limit(1).then(rows=>rows[0]),
  ]);
  if(!job)return NextResponse.json({error:"Vaga não encontrada"},{status:404});
  let description=job.description,source=description.length>80&&!description.startsWith("Importada do alerta RadarVagas:")?"stored":"alert";
  if(source==="alert"){
    const official=await descriptionFromLinkedIn(job.url);
    if(official){description=official;source="linkedin";await db.update(jobs).set({description,updatedAt:new Date()}).where(eq(jobs.id,job.id));await db.insert(jobEvents).values({jobId:job.id,type:"linkedin_description",detail:"Descrição oficial obtida na página pública da vaga.",occurredAt:new Date()})}
  }
  const inferredStack=inferTechnologyStack(`${job.title} ${description}`,parse(job.stack));
  if(JSON.stringify(inferredStack)!==JSON.stringify(parse(job.stack)))await db.update(jobs).set({stack:JSON.stringify(inferredStack),updatedAt:new Date()}).where(eq(jobs.id,job.id));
  const masteredSkills=listFromStored(profile?.masteredSkills),desiredAreas=listFromStored(profile?.desiredAreas),seniority=listFromStored(profile?.seniority),preferredMode=allowedWorkModes(profile?.preferredMode);
  const profileHasScoringSignals=Boolean(profile)&&[masteredSkills,desiredAreas,seniority,preferredMode].some(values=>values.length>0);
  const isTechJob=isTechnologyJob({title:job.title,description,stack:inferredStack});
  const match=!isTechJob
    ? {score:0,reasons:["Vaga fora do escopo de TI — sem pontuação"],scored:false}
    : profileHasScoringSignals
      ? {...scoreJob({title:job.title,description,stack:inferredStack,seniority:job.seniority,workMode:job.workMode,location:job.location,publishedAt:job.publishedAt??job.firstSeenAt},{masteredSkills,desiredAreas,avoidTerms:listFromStored(profile?.avoidTerms),seniority,preferredMode}),scored:true}
      : {score:0,reasons:["Complete seu perfil para calcular a aderência"],scored:false};
  return NextResponse.json({description,descriptionSource:source,stack:inferredStack,jobStatus:job.status,...match});
}
