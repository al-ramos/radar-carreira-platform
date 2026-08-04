import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db/index";
import { platformSettings, profiles } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";
export const dynamic="force-dynamic";
const ADMINS=new Set(["contato@amrsolution.com.br","alexsandro.ramos@gmail.com"]);
const defaults={id:"global",collectionEnabled:true,emailImportEnabled:true,enrichmentEnabled:true,defaultPeriod:"24",defaultMinScore:70,staleAfterDays:7,retentionDays:180,updatedBy:null,updatedAt:new Date()};
async function admin(){const u=await getChatGPTUser();if(!u)return null;if(ADMINS.has(u.email.toLowerCase()))return u;const p=(await getDb().select({role:profiles.role}).from(profiles).where(eq(profiles.userId,u.userId)).limit(1))[0];return p?.role==="admin"?u:null}
export async function GET(){if(!await admin())return NextResponse.json({error:"Acesso de administrador necessário"},{status:403});const db=getDb();let settings=(await db.select().from(platformSettings).where(eq(platformSettings.id,"global")).limit(1))[0];if(!settings){await db.insert(platformSettings).values(defaults);settings=defaults}return NextResponse.json({settings})}
export async function PUT(request:Request){const u=await admin();if(!u)return NextResponse.json({error:"Acesso de administrador necessário"},{status:403});const b=await request.json() as Record<string,unknown>,period=String(b.defaultPeriod??"24");const values={id:"global",collectionEnabled:Boolean(b.collectionEnabled),emailImportEnabled:Boolean(b.emailImportEnabled),enrichmentEnabled:Boolean(b.enrichmentEnabled),defaultPeriod:new Set(["24","72","168","all"]).has(period)?period:"24",defaultMinScore:Math.max(0,Math.min(100,Number(b.defaultMinScore)||0)),staleAfterDays:Math.max(1,Math.min(90,Number(b.staleAfterDays)||7)),retentionDays:Math.max(30,Math.min(1095,Number(b.retentionDays)||180)),updatedBy:u.userId,updatedAt:new Date()};await getDb().insert(platformSettings).values(values).onConflictDoUpdate({target:platformSettings.id,set:values});return NextResponse.json({ok:true,settings:values})}
