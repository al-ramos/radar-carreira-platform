import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { can } from "../../../../lib/rbac";
import { getDb } from "../../../../db/index";
import { importRuns,jobSources,jobs } from "../../../../db/schema";
export const dynamic="force-dynamic";
async function admin(){const u=await getChatGPTUser();if(!u)return null;return await can(u,"monitor.view")?u:null}
export async function GET(){if(!await admin())return NextResponse.json({error:"Acesso restrito a usuários autenticados"},{status:403});const started=Date.now(),db=getDb(),sources=await db.select().from(jobSources),runs=await db.select().from(importRuns).orderBy(desc(importRuns.startedAt)).limit(20),jobRows=await db.select({status:jobs.status,updatedAt:jobs.updatedAt}).from(jobs);
 const active=jobRows.filter(j=>j.status==="active").length,closed=jobRows.filter(j=>j.status!=="active").length,failures=runs.filter(r=>r.status==="failed").length,lastSuccess=runs.find(r=>r.status==="completed"),stale=sources.filter(s=>s.enabled&&s.collectionMode==="pull"&&(!s.lastRunAt||s.lastRunAt.getTime()<Date.now()-48*36e5));
 const status=failures>2||stale.length||sources.some(s=>s.enabled&&s.lastError)?"attention":"healthy";return NextResponse.json({status,responseMs:Date.now()-started,summary:{sources:sources.length,enabled:sources.filter(s=>s.enabled).length,active,closed,failures,lastSuccess:lastSuccess?.finishedAt??null},sources:sources.map(s=>({...s,stale:stale.some(x=>x.id===s.id)})),runs:runs.slice(0,10)})}
