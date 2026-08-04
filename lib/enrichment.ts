import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { jobEvents,jobs } from "../db/schema";

const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

export async function enrichLinkedInJobs(){
  const db=getDb(),rows=await db.select().from(jobs).where(eq(jobs.status,"active"));
  const official=rows.filter(job=>job.sourceId&&job.description.length>80),targets=rows.filter(job=>!job.sourceId&&job.description.startsWith("Importada do alerta RadarVagas:"));
  let enriched=0;
  for(const target of targets){const matches=official.filter(job=>normalize(job.company)===normalize(target.company)&&normalize(job.title)===normalize(target.title));if(matches.length!==1)continue;const source=matches[0];await db.update(jobs).set({description:source.description,stack:source.stack,seniority:source.seniority,workMode:source.workMode??target.workMode,location:source.location??target.location,updatedAt:new Date()}).where(eq(jobs.id,target.id));await db.insert(jobEvents).values({jobId:target.id,type:"official_enrichment",detail:`Descrição enriquecida pela fonte oficial: ${source.url}`,occurredAt:new Date()});enriched++}
  return enriched;
}
