import { and,desc,eq,gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { alertPreferences,alertReads,jobs,profiles } from "../../../db/schema";
import { scoreJob } from "../../../lib/scoring";
import { allowedWorkModes, listFromStored } from "../../../lib/profile-options";
export const dynamic="force-dynamic";
const parse=(v:string)=>{try{return JSON.parse(v) as string[]}catch{return[]}};
export async function GET(){const u=await getChatGPTUser();if(!u)return NextResponse.json({error:"Autenticação necessária"},{status:401});const db=getDb(),profile=(await db.select().from(profiles).where(eq(profiles.userId,u.userId)).limit(1))[0];if(!profile)return NextResponse.json({alerts:[],unread:0,preferences:{enabled:true,minScore:80,frequency:"daily"}});
 let pref=(await db.select().from(alertPreferences).where(eq(alertPreferences.userId,u.userId)).limit(1))[0];if(!pref){pref={userId:u.userId,enabled:true,minScore:Math.max(80,profile.minScore),frequency:"daily",updatedAt:new Date()};await db.insert(alertPreferences).values(pref)}
 if(!pref.enabled)return NextResponse.json({alerts:[],unread:0,preferences:pref});
 const rows=await db.select().from(jobs).where(and(eq(jobs.status,"active"),gte(jobs.publishedAt,new Date(Date.now()-7*864e5)))).orderBy(desc(jobs.publishedAt)).limit(100),reads=await db.select().from(alertReads).where(eq(alertReads.userId,u.userId)),seen=new Set(reads.map(r=>r.jobId));
 const alerts=rows.map(j=>{const stack=parse(j.stack),match=scoreJob({title:j.title,description:j.description,stack,seniority:j.seniority,workMode:j.workMode,location:j.location,publishedAt:j.publishedAt},{masteredSkills:listFromStored(profile.masteredSkills),desiredAreas:listFromStored(profile.desiredAreas),avoidTerms:listFromStored(profile.avoidTerms),seniority:listFromStored(profile.seniority),preferredMode:allowedWorkModes(profile.preferredMode)});return{id:j.id,title:j.title,company:j.company,url:j.url,publishedAt:j.publishedAt,score:match.score,reasons:match.reasons,read:seen.has(j.id)}}).filter(a=>a.score>=pref.minScore);
 return NextResponse.json({alerts,unread:alerts.filter(a=>!a.read).length,preferences:pref})}
export async function PUT(request:Request){const u=await getChatGPTUser();if(!u)return NextResponse.json({error:"Autenticação necessária"},{status:401});const b=await request.json() as {enabled?:boolean;minScore?:number;frequency?:string},values={userId:u.userId,enabled:b.enabled!==false,minScore:Math.max(0,Math.min(100,Number(b.minScore)||80)),frequency:b.frequency==="instant"?"instant" as const:"daily" as const,updatedAt:new Date()};await getDb().insert(alertPreferences).values(values).onConflictDoUpdate({target:alertPreferences.userId,set:values});return NextResponse.json({ok:true,preferences:values})}
export async function POST(request:Request){const u=await getChatGPTUser();if(!u)return NextResponse.json({error:"Autenticação necessária"},{status:401});const b=await request.json() as {jobId?:string};if(!b.jobId)return NextResponse.json({error:"Vaga obrigatória"},{status:400});const values={userId:u.userId,jobId:b.jobId,readAt:new Date()};await getDb().insert(alertReads).values(values).onConflictDoUpdate({target:[alertReads.userId,alertReads.jobId],set:{readAt:values.readAt}});return NextResponse.json({ok:true})}
