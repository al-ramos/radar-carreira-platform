import { NextResponse } from "next/server";
import { getDb } from "../../../db/index";
import { jobs } from "../../../db/schema";
export const dynamic="force-dynamic";
export async function GET(){const started=Date.now();try{await getDb().select({id:jobs.id}).from(jobs).limit(1);return NextResponse.json({status:"healthy",database:"connected",responseMs:Date.now()-started,checkedAt:new Date().toISOString()})}catch{return NextResponse.json({status:"degraded",database:"unavailable",responseMs:Date.now()-started,checkedAt:new Date().toISOString()},{status:503})}}
