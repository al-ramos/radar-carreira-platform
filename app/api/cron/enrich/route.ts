import { env } from "cloudflare:workers";
import { enrichLinkedInJobs } from "../../../../lib/enrichment";

export const dynamic="force-dynamic";
export async function POST(request:Request){const expected=(env as unknown as {COLLECTOR_SECRET?:string}).COLLECTOR_SECRET,provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");if(!expected||provided!==expected)return Response.json({error:"Não autorizado"},{status:401});return Response.json({ok:true,enriched:await enrichLinkedInJobs()})}
