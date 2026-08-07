import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { importRuns, jobSources, jobs } from "../../../../db/schema";
import { collect, isPullProvider } from "../../../../lib/connectors";
import { fingerprint } from "../../../../lib/jobs";
import { findCuratedSource } from "../../../../lib/curated-sources";
import { isOwnerEmail } from "../../../../lib/access";

export const dynamic = "force-dynamic";

const errorMessage=(error:unknown)=>error instanceof Error?error.message.slice(0,300):"Falha desconhecida na coleta";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  if (!isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  const db = getDb();

  const body = await request.json().catch(() => ({})) as { sourceId?: string; catalogId?: string; offset?: number };
  const curated = body.catalogId ? findCuratedSource(body.catalogId) : null;
  if (body.catalogId && !curated) return NextResponse.json({ error: "Empresa não encontrada no catálogo" }, { status: 404 });
  let candidates = body.sourceId
    ? await db.select().from(jobSources).where(eq(jobSources.id, body.sourceId))
    : await db.select().from(jobSources).where(eq(jobSources.enabled, true));
  if (curated) {
    let source = (await db.select().from(jobSources).where(and(eq(jobSources.provider, curated.provider), eq(jobSources.externalRef, curated.externalRef))).limit(1))[0];
    if (!source) {
      source = { id: crypto.randomUUID(), name: curated.name, provider: curated.provider, collectionMode: "pull" as const, externalRef: curated.externalRef, enabled: true, lastRunAt: null, lastAttemptAt: null, lastSuccessAt: null, lastError: null, consecutiveFailures: 0, createdAt: new Date() };
      await db.insert(jobSources).values(source);
    } else if (!source.enabled) {
      await db.update(jobSources).set({ enabled: true }).where(eq(jobSources.id, source.id));
      source = { ...source, enabled: true };
    }
    candidates = [source];
  }
  if (!candidates.length) return NextResponse.json({ error: "Fonte não encontrada ou desativada" }, { status: 404 });
  const eligibleSources = candidates.filter(source => source.enabled && source.collectionMode === "pull" && isPullProvider(source.provider));
  if (body.sourceId && !eligibleSources.length) return NextResponse.json({ error: "Esta integração recebe vagas enviadas por outro serviço e não suporta coleta automática" }, { status: 400 });
  if (!eligibleSources.length) return NextResponse.json({ ok: true, sources: 0, received: 0, inserted: 0, updated: 0, errors: 0, message: "Nenhuma fonte de coleta automática está ativa. Cadastre uma fonte Greenhouse, Lever ou Ashby." });
  const bulk = !body.sourceId && !curated;
  const offset = bulk ? Math.max(0, Number(body.offset) || 0) : 0;
  // Uma fonte por requisição: algumas empresas publicam muitas vagas e a
  // gravação no banco remoto precisa terminar antes de seguir para a próxima.
  const sources = bulk ? eligibleSources.slice(offset, offset + 1) : eligibleSources;
  if (!sources.length) return NextResponse.json({ ok: true, sources: 0, received: 0, inserted: 0, updated: 0, errors: 0, outcomes: [], totalSources: eligibleSources.length, processed: eligibleSources.length, nextOffset: null });

  let received = 0;
  let inserted = 0;
  let updated = 0;
  let errors = 0;
  const outcomes:Array<{id:string;name:string;status:"completed"|"failed";received:number;inserted:number;updated:number;error?:string}>=[];

  for (const source of sources) {
    const runId = crypto.randomUUID();
    const startedAt = new Date();
    await db.insert(importRuns).values({ id: runId, source: source.name, status: "running", received: 0, actorUserId: user.userId, startedAt });
    await db.update(jobSources).set({ lastAttemptAt: startedAt }).where(eq(jobSources.id, source.id));
    try {
      const found = await collect(source.provider, source.externalRef, source.name);
      received += found.length;
      let sourceInserted = 0;
      let sourceUpdated = 0;
      for (const job of found) {
        const fp = fingerprint(job);
        const now = new Date();
        const existing = (await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.fingerprint, fp)).limit(1))[0];
        const values = {
          id: existing?.id ?? crypto.randomUUID(), fingerprint: fp, sourceId: source.id,
          externalId: job.externalId ?? null, company: job.company, title: job.title,
          seniority: job.seniority ?? null, workMode: job.workMode ?? null,
          location: job.location ?? null, stack: JSON.stringify(job.stack ?? []),
          publishedAt: job.publishedAt ? new Date(job.publishedAt) : null,
          url: job.url, description: job.description ?? "", firstSeenAt: now,
          lastSeenAt: now, status: "active" as const, createdAt: now, updatedAt: now,
        };
        await db.insert(jobs).values(values).onConflictDoUpdate({
          target: jobs.fingerprint,
          set: { sourceId: source.id, title: values.title, location: values.location, workMode: values.workMode, publishedAt: values.publishedAt, url: values.url, description: values.description, lastSeenAt: now, status: "active", updatedAt: now },
        });
        existing ? sourceUpdated++ : sourceInserted++;
      }
      inserted += sourceInserted;
      updated += sourceUpdated;
      await db.update(importRuns).set({ status: "completed", received: found.length, inserted: sourceInserted, updated: sourceUpdated, finishedAt: new Date() }).where(eq(importRuns.id, runId));
      const finishedAt=new Date();
      await db.update(jobSources).set({ lastRunAt: finishedAt, lastSuccessAt: finishedAt, lastError: null, consecutiveFailures: 0 }).where(eq(jobSources.id, source.id));
      outcomes.push({id:source.id,name:source.name,status:"completed",received:found.length,inserted:sourceInserted,updated:sourceUpdated});
    } catch (error) {
      errors++;
      const message=errorMessage(error),finishedAt=new Date();
      await db.update(importRuns).set({ status: "failed", errors: 1, finishedAt }).where(eq(importRuns.id, runId));
      await db.update(jobSources).set({ lastError: message, consecutiveFailures: source.consecutiveFailures+1 }).where(eq(jobSources.id, source.id));
      outcomes.push({id:source.id,name:source.name,status:"failed",received:0,inserted:0,updated:0,error:message});
    }
  }
  const processed = Math.min(offset + sources.length, eligibleSources.length);
  return NextResponse.json({ ok: errors === 0, sources: sources.length, received, inserted, updated, errors, outcomes, totalSources: eligibleSources.length, processed, nextOffset: bulk && processed < eligibleSources.length ? processed : null });
}
