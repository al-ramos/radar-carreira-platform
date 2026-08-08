import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobSources,profiles } from "../../../../db/schema";

export const dynamic="force-dynamic";
const ADMIN_EMAILS=new Set(["contato@amrsolution.com.br","alexsandro.ramos@gmail.com","prof.andreiamr@gmail.com"]);
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,"0")).join("");
export async function POST(request:Request){const user=await getChatGPTUser();if(!user)return Response.json({error:"Autenticação necessária"},{status:401});const db=getDb(),profile=(await db.select({role:profiles.role}).from(profiles).where(eq(profiles.userId,user.userId)).limit(1))[0];if(profile?.role!=="admin"&&!ADMIN_EMAILS.has(user.email.toLowerCase()))return Response.json({error:"Acesso de administrador necessário"},{status:403});const body=await request.json() as {secret?:string},secret=body.secret?.trim()??"";if(secret.length<24)return Response.json({error:"Use uma chave com pelo menos 24 caracteres"},{status:400});const values={id:"gmail-radarvagas",name:"Gmail/RadarVagas",provider:"manual" as const,collectionMode:"push" as const,externalRef:JSON.stringify({hash:await digest(secret),userId:user.userId}),enabled:true,lastRunAt:null,createdAt:new Date()};await db.insert(jobSources).values(values).onConflictDoUpdate({target:jobSources.id,set:{externalRef:values.externalRef,collectionMode:"push",enabled:true}});return Response.json({ok:true})}
