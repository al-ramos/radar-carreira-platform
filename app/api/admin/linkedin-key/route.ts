import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobSources,profiles } from "../../../../db/schema";
import { hashCollectorSecret } from "../../../../lib/linkedin-collector-auth";

export const dynamic="force-dynamic";
const ADMIN_EMAILS=new Set(["contato@amrsolution.com.br","alexsandro.ramos@gmail.com","prof.andreiamr@gmail.com"]);
async function admin(){const user=await getChatGPTUser();if(!user)return null;const profile=(await getDb().select({role:profiles.role}).from(profiles).where(eq(profiles.userId,user.userId)).limit(1))[0];return profile?.role==="admin"||ADMIN_EMAILS.has(user.email.toLowerCase())?user:null}

export async function GET(){if(!await admin())return Response.json({error:"Acesso de administrador necessário"},{status:403});const source=(await getDb().select({id:jobSources.id,createdAt:jobSources.createdAt}).from(jobSources).where(eq(jobSources.id,"linkedin-extension")).limit(1))[0];return Response.json({configured:Boolean(source),configuredAt:source?.createdAt??null})}

export async function POST(request:Request){
 const user=await admin();if(!user)return Response.json({error:"Acesso de administrador necessário"},{status:403});
 const body=await request.json() as {secret?:string},secret=body.secret?.trim()??"";
 if(secret.length<24)return Response.json({error:"Use uma chave com pelo menos 24 caracteres"},{status:400});
 const values={id:"linkedin-extension",name:"Extensão LinkedIn",provider:"manual" as const,externalRef:JSON.stringify({hash:await hashCollectorSecret(secret),userId:user.userId}),enabled:true,lastRunAt:null,createdAt:new Date()};
 await getDb().insert(jobSources).values(values).onConflictDoUpdate({target:jobSources.id,set:{externalRef:values.externalRef,enabled:true}});
 return Response.json({ok:true});
}
