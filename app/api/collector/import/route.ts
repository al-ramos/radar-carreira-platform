import { eq } from "drizzle-orm";
import { getDb } from "../../../../db/index";
import { importRuns, jobSources, jobs } from "../../../../db/schema";
import { normalizeImportedJobs } from "../../../../lib/import-jobs";
import { fingerprint } from "../../../../lib/jobs";

export const dynamic = "force-dynamic";
const SOURCE_ID = "linkedin-extension";
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(byte => byte.toString(16).padStart(2, "0")).join("");

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return Response.json({ error: "Chave do coletor ausente" }, { status: 401 });
  const db = getDb();
  const source = (await db.select().from(jobSources).where(eq(jobSources.id, SOURCE_ID)).limit(1))[0];
  let config: { hash?: string; userId?: string } = {};
  try { config = source ? JSON.parse(source.externalRef) as typeof config : {}; } catch { /* invalidated integration */ }
  if (!source || !source.enabled || !config.hash || config.hash !== await digest(token)) return Response.json({ error: "Chave do coletor inválida" }, { status: 401 });
  const payload = await request.json().catch(() => null) as { action?: string; jobs?: unknown[] } | null;
  if (payload?.action === "test") return Response.json({ ok: true, connected: true });
  const items = normalizeImportedJobs(Array.isArray(payload?.jobs) ? payload.jobs : []);
  if (!items.length) return Response.json({ error: "Nenhuma vaga válida recebida" }, { status: 400 });
  if (items.length > 2000) return Response.json({ error: "O limite é de 2.000 vagas por envio" }, { status: 400 });
  const runId = crypto.randomUUID(), startedAt = new Date();
  await db.insert(importRuns).values({ id: runId, source: "Extensão LinkedIn", status: "running", received: items.length, actorUserId: config.userId ?? "collector", startedAt });
  let inserted = 0, updated = 0;
  for (const job of items) {
    const fp = fingerprint(job), now = new Date(), existing = (await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.fingerprint, fp)).limit(1))[0];
    const values = { id: existing?.id ?? crypto.randomUUID(), fingerprint: fp, sourceId: SOURCE_ID, externalId: job.externalId ?? null, company: job.company, title: job.title, seniority: job.seniority ?? null, workMode: job.workMode ?? null, location: job.location ?? null, stack: JSON.stringify(job.stack ?? []), publishedAt: job.publishedAt ? new Date(job.publishedAt) : null, url: job.url, description: job.description ?? "", firstSeenAt: now, lastSeenAt: now, status: "active" as const, createdAt: now, updatedAt: now };
    await db.insert(jobs).values(values).onConflictDoUpdate({ target: jobs.fingerprint, set: { sourceId: SOURCE_ID, externalId: values.externalId, company: values.company, title: values.title, seniority: values.seniority, workMode: values.workMode, location: values.location, stack: values.stack, publishedAt: values.publishedAt, url: values.url, description: values.description, lastSeenAt: now, status: "active", updatedAt: now } });
    if (existing) updated++; else inserted++;
  }
  await db.update(importRuns).set({ status: "completed", inserted, updated, finishedAt: new Date() }).where(eq(importRuns.id, runId));
  await db.update(jobSources).set({ lastRunAt: new Date() }).where(eq(jobSources.id, SOURCE_ID));
  return Response.json({ ok: true, accepted: items.length, rejected: 0, inserted, updated });
}
