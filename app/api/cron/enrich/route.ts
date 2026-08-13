import { enrichLinkedInJobs } from "../../../../lib/enrichment";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db/index";
import { platformSettings } from "../../../../db/schema";

export const dynamic="force-dynamic";
export async function POST(request:Request){if(request.headers.get("x-radar-collector-authenticated")!=="1")return Response.json({error:"Não autorizado"},{status:401});const settings=(await getDb().select({enabled:platformSettings.enrichmentEnabled}).from(platformSettings).where(eq(platformSettings.id,"global")).limit(1))[0];if(settings&&!settings.enabled)return Response.json({ok:true,skipped:true,message:"Enriquecimento pausado pelo administrador"});return Response.json({ok:true,enriched:await enrichLinkedInJobs()})}
