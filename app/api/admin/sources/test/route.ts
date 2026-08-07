import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobSources, profiles } from "../../../../../db/schema";
import { validate, isPullProvider } from "../../../../../lib/connectors";
const ADMINS=new Set(["contato@amrsolution.com.br","alexsandro.ramos@gmail.com","prof.andreiamr@gmail.com"]);
export async function POST(request:Request){const user=await getChatGPTUser();if(!user)return NextResponse.json({error:"Autenticação necessária"},{status:401});const db=getDb(),profile=(await db.select({role:profiles.role}).from(profiles).where(eq(profiles.userId,user.userId)).limit(1))[0];if(profile?.role!=="admin"&&!ADMINS.has(user.email.toLowerCase()))return NextResponse.json({error:"Acesso de administrador necessário"},{status:403});const body=await request.json() as {sourceId?:string},source=body.sourceId&&(await db.select().from(jobSources).where(eq(jobSources.id,body.sourceId)).limit(1))[0];if(!source||source.collectionMode!=="pull"||!isPullProvider(source.provider))return NextResponse.json({error:"Fonte automática não encontrada"},{status:404});try{const result=await validate(source.provider,source.externalRef,source.name);return NextResponse.json({ok:true,status:result.status,jobsCount:result.jobsCount,foundName:result.foundName})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Falha ao testar a fonte"},{status:400})}}
