import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { draftOutbox, jobs, profiles, triageHistory, userJobAnalyses } from "../../../../../db/schema";
import { getAnalysisVersions } from "../../../../../lib/analysis-versions";
import { canonicalizeProfile, profileIsReadyForTriage } from "../../../../../lib/canonical-profile";
import { evaluateDeterministicTriage } from "../../../../../lib/deterministic-triage";
import { isSafeForDraft } from "../../../../../lib/draft-eligibility";

function parseStack(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export const dynamic = "force-dynamic";

/**
 * Reserva a fila persistente para o futuro criador de rascunhos. Não conversa
 * com Gmail e nunca envia e-mail. O perfil canônico é relido nesta requisição,
 * e somente análises da mesma versão entram na fila.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const db = getDb();
  const body = await request.json().catch(() => ({})) as { action?: "queue" | "retryFailed" };
  if (body.action === "retryFailed") {
    const now = new Date();
    const failed = await db.select({ id: draftOutbox.id }).from(draftOutbox).where(and(eq(draftOutbox.userId, user.userId), eq(draftOutbox.status, "failed")));
    for (const item of failed) await db.update(draftOutbox).set({ status: "pending", error: null, updatedAt: now }).where(eq(draftOutbox.id, item.id));
    return NextResponse.json({ ok: true, retried: failed.length, sent: false });
  }
  const profile = await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de preparar rascunhos." }, { status: 412 });

  const canonicalProfile = canonicalizeProfile(profile);
  if (!profileIsReadyForTriage(canonicalProfile)) return NextResponse.json({ error: "O perfil técnico ainda não está pronto para triagem." }, { status: 412 });
  const versions = getAnalysisVersions(canonicalProfile);
  const [historyRows, existingOutbox] = await Promise.all([
    db.select({
      id: triageHistory.id,
      jobId: triageHistory.jobId,
      verdict: triageHistory.verdict,
      profileRevision: triageHistory.profileRevision,
      rulesRevision: triageHistory.rulesRevision,
      instructionsRevision: triageHistory.instructionsRevision,
      job: jobs,
      analysis: userJobAnalyses,
    })
      .from(triageHistory)
      .innerJoin(jobs, eq(triageHistory.jobId, jobs.id))
      .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, jobs.id)))
      .where(eq(triageHistory.userId, user.userId))
      .orderBy(desc(triageHistory.createdAt)),
    db.select({ jobId: draftOutbox.jobId, status: draftOutbox.status }).from(draftOutbox).where(eq(draftOutbox.userId, user.userId)),
  ]);

  const alreadyQueued = new Set(existingOutbox.map((row) => row.jobId));
  const latestByJob = new Map<string, typeof historyRows[number]>();
  for (const row of historyRows) if (!latestByJob.has(row.jobId)) latestByJob.set(row.jobId, row);

  const now = new Date();
  const queued: string[] = [];
  let noValidContact = 0;
  let notEligible = 0;
  let outdated = 0;
  let alreadyPresent = 0;
  for (const row of latestByJob.values()) {
    if (alreadyQueued.has(row.jobId)) { alreadyPresent += 1; continue; }
    const sameVersion = row.profileRevision === versions.profileRevision && row.rulesRevision === versions.rulesRevision && row.instructionsRevision === versions.instructionsRevision;
    if (!sameVersion) { outdated += 1; continue; }
    const analysisIsCurrent = row.analysis
      && row.analysis.profileRevision === versions.profileRevision
      && row.analysis.rulesRevision === versions.rulesRevision
      && row.analysis.instructionsRevision === versions.instructionsRevision;
    if (!analysisIsCurrent) { outdated += 1; continue; }
    const current = evaluateDeterministicTriage({
      title: row.job.title,
      description: row.job.description,
      stack: parseStack(row.job.stack),
      seniority: row.job.seniority,
      workMode: row.job.workMode,
      location: row.job.location,
      publishedAt: row.job.publishedAt,
    }, canonicalProfile);
    if (!isSafeForDraft({
      verdict: row.analysis.verdict,
      blocker: row.analysis.blocker,
      contactEmail: row.job.contactEmail,
      deterministicVerdict: current.verdict,
      deterministicBlocker: current.blocker,
    })) {
      if (!row.job.contactEmail?.trim()) noValidContact += 1;
      else notEligible += 1;
      continue;
    }
    await db.insert(draftOutbox).values({ id: crypto.randomUUID(), userId: user.userId, jobId: row.jobId, historyId: row.id, status: "pending", createdAt: now, updatedAt: now });
    queued.push(row.jobId);
  }

  return NextResponse.json({ ok: true, queued: queued.length, noValidContact, notEligible, outdated, alreadyPresent, gmailDraftsCreated: 0 });
}
