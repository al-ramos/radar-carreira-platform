import { enrichLinkedInJobs } from "../../../../lib/enrichment";

export const dynamic="force-dynamic";
export async function POST(request:Request){if(request.headers.get("x-radar-collector-authenticated")!=="1")return Response.json({error:"Não autorizado"},{status:401});return Response.json({ok:true,enriched:await enrichLinkedInJobs()})}
