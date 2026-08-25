import { reconcileJobLifecycle } from "../../../../lib/lifecycle";
import { heartbeat } from "../../../../lib/automation-heartbeat";
import { recordDatabaseFailure } from "../../../../lib/database-failure";
export const dynamic="force-dynamic";
export async function POST(request:Request){if(request.headers.get("x-radar-collector-authenticated")!=="1")return Response.json({error:"Não autorizado"},{status:401});await heartbeat("lifecycle","running");try{const result=await reconcileJobLifecycle();await heartbeat("lifecycle","completed");return Response.json({ok:true,...result})}catch(error){await recordDatabaseFailure("cron.lifecycle",error,"A reconciliação de ciclo de vida não conseguiu atualizar vagas no D1.");await heartbeat("lifecycle","failed",error);throw error}}
