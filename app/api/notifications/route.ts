import { desc,eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db/index";
import { notifications } from "../../../db/schema";
import { isOwnerEmail } from "../../../lib/access";
export const dynamic="force-dynamic";
const LIST_LIMIT=50;
const parse=(v:string)=>{try{return JSON.parse(v) as Record<string,unknown>}catch{return{}}};

/**
 * Sino de notificações: sem `userId` na tabela (ver comentário em
 * db/schema.ts), então quem pode ler é decidido aqui, do mesmo jeito que o
 * bypass de `lib/rbac.ts` — só a proprietária da conta.
 */
export async function GET(){
 const u=await getChatGPTUser();if(!u)return NextResponse.json({error:"Autenticação necessária"},{status:401});
 if(!isOwnerEmail(u.email))return NextResponse.json({notifications:[],unread:0});
 const rows=await getDb().select().from(notifications).orderBy(desc(notifications.createdAt)).limit(LIST_LIMIT);
 const list=rows.map(n=>({id:n.id,type:n.type,severity:n.severity,title:n.title,body:n.body,link:n.link,metadata:parse(n.metadata),read:n.read,createdAt:n.createdAt}));
 return NextResponse.json({notifications:list,unread:list.filter(n=>!n.read).length});
}

export async function POST(request:Request){
 const u=await getChatGPTUser();if(!u)return NextResponse.json({error:"Autenticação necessária"},{status:401});
 if(!isOwnerEmail(u.email))return NextResponse.json({error:"Acesso restrito ao proprietário"},{status:403});
 const b=await request.json().catch(()=>({})) as {id?:string;all?:boolean};
 if(b.all){await getDb().update(notifications).set({read:true}).where(eq(notifications.read,false));return NextResponse.json({ok:true})}
 if(!b.id)return NextResponse.json({error:"Informe id ou all: true"},{status:400});
 await getDb().update(notifications).set({read:true}).where(eq(notifications.id,b.id));
 return NextResponse.json({ok:true});
}
