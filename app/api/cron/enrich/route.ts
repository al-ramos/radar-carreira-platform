import { enrichLinkedInJobs } from "../../../../lib/enrichment";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db/index";
import { platformSettings } from "../../../../db/schema";
import { heartbeat } from "../../../../lib/automation-heartbeat";
import { recordDatabaseFailure } from "../../../../lib/database-failure";

export const dynamic="force-dynamic";
export async function POST(request:Request){if(request.headers.get("x-radar-collector-authenticated")!=="1")return Response.json({error:"Não autorizado"},{status:401});await heartbeat("enrich","running");try{const settings=(await getDb().select({enabled:platformSettings.enrichmentEnabled}).from(platformSettings).where(eq(platformSettings.id,"global")).limit(1))[0];if(settings&&!settings.enabled){await heartbeat("enrich","skipped");return Response.json({ok:true,skipped:true,message:"Enriquecimento pausado pelo administrador"})}const enriched=await enrichLinkedInJobs();await heartbeat("enrich","completed");return Response.json({ok:true,enriched})}catch(error){await recordDatabaseFailure("cron.enrich",error,"O enriquecimento não conseguiu atualizar vagas no D1.");await heartbeat("enrich","failed",error);throw error}}
