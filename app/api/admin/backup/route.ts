import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { importRuns,jobEvents,jobs,jobSources,platformSettings } from "../../../../db/schema";
import { can } from "../../../../lib/access";
export const dynamic="force-dynamic";
async function admin(){const u=await getChatGPTUser();if(!u)return null;return await can(u,"backup.export")?u:null}
export async function GET(){if(!await admin())return NextResponse.json({error:"Acesso de administrador necessário"},{status:403});const db=getDb(),[jobRows,sources,runs,events,settings]=await Promise.all([db.select().from(jobs).orderBy(desc(jobs.updatedAt)),db.select().from(jobSources),db.select().from(importRuns).orderBy(desc(importRuns.startedAt)),db.select().from(jobEvents).orderBy(desc(jobEvents.occurredAt)),db.select().from(platformSettings).limit(1)]),safeSources=sources.map(s=>({id:s.id,name:s.name,provider:s.provider,externalRef:s.id==="gmail-radarvagas"?"[protegido]":s.externalRef,enabled:s.enabled,lastRunAt:s.lastRunAt,createdAt:s.createdAt})),safeSettings=settings[0]?{...settings[0],updatedBy:null}:null,backup={format:"radar-carreira-backup",version:1,exportedAt:new Date().toISOString(),counts:{jobs:jobRows.length,sources:safeSources.length,runs:runs.length,events:events.length},data:{jobs:jobRows,sources:safeSources,importRuns:runs,jobEvents:events,platformSettings:safeSettings}};return new NextResponse(JSON.stringify(backup,null,2),{headers:{"content-type":"application/json; charset=utf-8","content-disposition":`attachment; filename="radar-carreira-backup-${new Date().toISOString().slice(0,10)}.json"`,"cache-control":"no-store"}})}
