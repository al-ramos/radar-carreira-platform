import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobSources } from "../../../../db/schema";
import { can } from "../../../../lib/access";
import { parseCareerSource } from "../../../../lib/career-source";
import { validate, isPullProvider } from "../../../../lib/connectors";
import { CURATED_SOURCES } from "../../../../lib/curated-sources";
import { isAmbiguousSlug, slugGuardReasons } from "../../../../lib/slug-guard";

export const dynamic = "force-dynamic";

async function owner(permissionId: "sources.view" | "sources.manage" = "sources.manage") {
  const user = await getChatGPTUser();
  return user && await can(user, permissionId) ? user : null;
}

function ownerOnly() {
  return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
}

export async function GET() {
  if (!await owner("sources.view")) return ownerOnly();
  const rows = await getDb().select().from(jobSources).orderBy(desc(jobSources.createdAt));
  return NextResponse.json({
    sources: rows.map(({ externalRef, ...source }) => {
      const derivedStatus = source.lastError
        ? source.lastError.startsWith("MISMATCH:") ? "mismatch" : source.lastError.startsWith("EMPTY:") ? "empty" : "error"
        : source.lastSuccessAt ? "ok" : null;
      const derivedFoundName = derivedStatus === "mismatch" ? source.lastError!.slice(9).trim() : undefined;
      return {
        ...source,
        externalRef: source.collectionMode === "pull" ? externalRef : null,
        canCollect: source.collectionMode === "pull" && isPullProvider(source.provider),
        catalogId: CURATED_SOURCES.find((item) => item.provider === source.provider && item.externalRef === externalRef)?.id,
        validationStatus: source.validationStatus ?? derivedStatus,
        foundName: source.foundName ?? derivedFoundName,
      };
    }),
  });
}

export async function POST(request: Request) {
  if (!await owner()) return ownerOnly();
  const body = await request.json() as { name?: string; provider?: string; careerUrl?: string; externalRef?: string; test?: boolean; forceAdd?: boolean };
  let parsed;
  try { parsed = body.careerUrl ? parseCareerSource(body.careerUrl, body.provider) : null; }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Link inválido" }, { status: 400 }); }
  const provider = parsed?.provider ?? body.provider;
  const externalRef = parsed?.externalRef ?? body.externalRef?.trim();
  const name = body.name?.trim() || parsed?.suggestedName;
  if (!name || !externalRef || !isPullProvider(provider ?? "")) return NextResponse.json({ error: "Informe uma empresa e um link público Greenhouse, Lever ou Ashby." }, { status: 400 });
  if (isAmbiguousSlug(externalRef) && !body.forceAdd) return NextResponse.json({ ok: false, warning: "slug_ambiguous", reasons: slugGuardReasons(externalRef), requiresManualReview: true }, { status: 422 });
  let validation: { status: string; jobsCount: number; foundName?: string } | undefined;
  try { if (body.test) validation = await validate(provider, externalRef, name); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? `Não localizamos uma página pública nesse endereço: ${error.message}` : "Não foi possível testar esta fonte" }, { status: 400 }); }
  const source = { id: crypto.randomUUID(), name, provider, collectionMode: "pull" as const, externalRef, enabled: true, lastRunAt: null, createdAt: new Date() };
  await getDb().insert(jobSources).values(source);
  return NextResponse.json({ ok: true, source, ...(validation ? { status: validation.status, jobsCount: validation.jobsCount, foundName: validation.foundName } : {}) });
}

export async function PUT() {
  if (!await owner()) return ownerOnly();
  const db = getDb(); let added = 0; let reactivated = 0;
  for (const item of CURATED_SOURCES) {
    const existing = (await db.select().from(jobSources).where(and(eq(jobSources.provider, item.provider), eq(jobSources.externalRef, item.externalRef))).limit(1))[0];
    if (!existing) { await db.insert(jobSources).values({ id: crypto.randomUUID(), name: item.name, provider: item.provider, collectionMode: "pull", externalRef: item.externalRef, enabled: true, lastRunAt: null, createdAt: new Date() }); added++; }
    else if (!existing.enabled) { await db.update(jobSources).set({ enabled: true }).where(eq(jobSources.id, existing.id)); reactivated++; }
  }
  return NextResponse.json({ ok: true, added, reactivated, total: CURATED_SOURCES.length });
}

export async function PATCH(request: Request) {
  if (!await owner()) return ownerOnly();
  const body = await request.json() as { id?: string; enabled?: boolean };
  if (!body.id || typeof body.enabled !== "boolean") return NextResponse.json({ error: "Fonte e estado são obrigatórios" }, { status: 400 });
  await getDb().update(jobSources).set({ enabled: body.enabled }).where(eq(jobSources.id, body.id));
  return NextResponse.json({ ok: true });
}
