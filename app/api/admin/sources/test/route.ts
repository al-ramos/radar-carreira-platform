import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobSources } from "../../../../../db/schema";
import { can } from "../../../../../lib/rbac";
import { validate, isPullProvider } from "../../../../../lib/connectors";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!await can(user, "sources.manage")) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  const body = await request.json() as { sourceId?: string };
  const source = body.sourceId && (await getDb().select().from(jobSources).where(eq(jobSources.id, body.sourceId)).limit(1))[0];
  if (!source || source.collectionMode !== "pull" || !isPullProvider(source.provider)) return NextResponse.json({ error: "Fonte automática não encontrada" }, { status: 404 });
  try {
    const result = await validate(source.provider, source.externalRef, source.name);
    return NextResponse.json({ ok: true, status: result.status, jobsCount: result.jobsCount, foundName: result.foundName });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao testar a fonte" }, { status: 400 });
  }
}
