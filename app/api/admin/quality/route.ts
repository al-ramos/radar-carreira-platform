import { desc,eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { can } from "../../../../lib/rbac";
import { getDb } from "../../../../db/index";
import { jobs } from "../../../../db/schema";
import { enrichLinkedInJobs } from "../../../../lib/enrichment";
export const dynamic="force-dynamic";
async function admin(permissionId:"quality.view"|"quality.enrich"){const u=await getChatGPTUser();if(!u)return null;return await can(u,permissionId)?u:null}
const parse=(v:string)=>{try{return JSON.parse(v) as string[]}catch{return[]}};
function quality(j:typeof jobs.$inferSelect){const issues:string[]=[];if(j.description.trim().length<80)issues.push("Descrição incompleta");if(!j.location)issues.push("Local ausente");if(!j.workMode)issues.push("Modalidade ausente");if(!j.publishedAt)issues.push("Data ausente");if(!parse(j.stack).length)issues.push("Tecnologias ausentes");return{score:Math.max(0,100-issues.length*20),issues}}
export async function GET(){if(!await admin("quality.view"))return NextResponse.json({error:"Acesso restrito a usuários autenticados"},{status:403});const rows=await getDb().select().from(jobs).where(eq(jobs.status,"active")).orderBy(desc(jobs.updatedAt)).limit(1000),analyzed=rows.map(j=>({...quality(j),id:j.id,title:j.title,company:j.company,source:j.sourceId?"Oficial":"E-mail/manual"})),counts={description:analyzed.filter(x=>x.issues.includes("Descrição incompleta")).length,location:analyzed.filter(x=>x.issues.includes("Local ausente")).length,mode:analyzed.filter(x=>x.issues.includes("Modalidade ausente")).length,date:analyzed.filter(x=>x.issues.includes("Data ausente")).length,stack:analyzed.filter(x=>x.issues.includes("Tecnologias ausentes")).length},average=analyzed.length?Math.round(analyzed.reduce((s,x)=>s+x.score,0)/analyzed.length):100;return NextResponse.json({average,total:analyzed.length,complete:analyzed.filter(x=>x.score===100).length,counts,attention:analyzed.filter(x=>x.score<100).sort((a,b)=>a.score-b.score).slice(0,30)})}
export async function POST(){if(!await admin("quality.enrich"))return NextResponse.json({error:"Acesso restrito a usuários autenticados"},{status:403});return NextResponse.json({ok:true,enriched:await enrichLinkedInJobs()})}
