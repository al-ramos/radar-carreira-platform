import { desc,eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { jobs,userJobStatus } from "../../../db/schema";
export const dynamic="force-dynamic";
const parse=(v:string)=>{try{return JSON.parse(v) as string[]}catch{return[]}};
export async function GET(){const u=await getChatGPTUser();if(!u)return NextResponse.json({error:"Autenticação necessária"},{status:401});const db=getDb(),jobRows=await db.select().from(jobs).orderBy(desc(jobs.publishedAt)).limit(500),pipeline=await db.select().from(userJobStatus).where(eq(userJobStatus.userId,u.userId));
 const stages=["saved","applied","interview","offer","rejected","archived"],stageCounts=Object.fromEntries(stages.map(s=>[s,pipeline.filter(p=>p.stage===s).length])),applications=stageCounts.applied+stageCounts.interview+stageCounts.offer+stageCounts.rejected,interviewRate=applications?Math.round((stageCounts.interview+stageCounts.offer)*100/applications):0,offerRate=applications?Math.round(stageCounts.offer*100/applications):0;
 const companyMap=new Map<string,number>(),techMap=new Map<string,number>();for(const j of jobRows){companyMap.set(j.company,(companyMap.get(j.company)||0)+1);for(const tech of parse(j.stack))techMap.set(tech,(techMap.get(tech)||0)+1)}
 const top=(m:Map<string,number>,limit=8)=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([name,count])=>({name,count}));
 const active=jobRows.filter(j=>j.status==="active").length,recent=jobRows.filter(j=>j.publishedAt&&j.publishedAt.getTime()>Date.now()-30*864e5).length;
 return NextResponse.json({summary:{active,recent,pipeline:pipeline.length,applications,interviewRate,offerRate},stages:stageCounts,companies:top(companyMap),technologies:top(techMap)})}
