import { reconcileJobLifecycle } from "../../../../lib/lifecycle";
import { heartbeat } from "../../../../lib/automation-heartbeat";
export const dynamic="force-dynamic";
export async function POST(request:Request){if(request.headers.get("x-radar-collector-authenticated")!=="1")return Response.json({error:"Não autorizado"},{status:401});await heartbeat("lifecycle","running");try{const result=await reconcileJobLifecycle();await heartbeat("lifecycle","completed");return Response.json({ok:true,...result})}catch(error){await heartbeat("lifecycle","failed",error);throw error}}
