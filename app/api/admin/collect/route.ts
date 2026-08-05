import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { importRuns, jobSources, jobs, profiles } from "../../../../db/schema";
import { collect } from "../../../../lib/connectors";
import { fingerprint } from "../../../../lib/jobs";

export const dynamic = "force-dynamic";

const ADMINS = new Set([
  "contato@amrsolution.com.br",
  "alexsandro.ramos@gmail.com",
  "prof.andreiamr@gmail.com",
]);

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  const db = getDb();
  const profile = (await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
  if (profile?.role !== "admin" && !ADMINS.has(user.email.toLowerCase())) {
    return NextResponse.json({ error: "Acesso de administrador necessário" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { sourceId?: string };
  const sources = body.sourceId
    ? await db.select().from(jobSources).where(eq(jobSources.id, body.sourceId))
    : await db.select().from(jobSources).where(eq(jobSources.enabled, true));
  if (!sources.length) return NextResponse.json({ error: "Cadastre ao menos uma fonte ativa" }, { status: 400 });

  let received = 0;
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const source of sources) {
    const runId = crypto.randomUUID();
    const startedAt = new Date();
    await db.insert(importRuns).values({ id: runId, source: source.name, status: "running", received: 0, actorUserId: user.userId, startedAt });
    try {
      const found = await collect(source.provider as "greenhouse" | "lever" | "ashby", source.externalRef, source.name);
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
      await db.update(jobSources).set({ lastRunAt: new Date() }).where(eq(jobSources.id, source.id));
    } catch {
      errors++;
      await db.update(importRuns).set({ status: "failed", errors: 1, finishedAt: new Date() }).where(eq(importRuns.id, runId));
    }
  }
  return NextResponse.json({ ok: errors === 0, sources: sources.length, received, inserted, updated, errors });
}
