import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { draftOutbox, jobs, profiles, triageBatches, triageHistory, userJobAnalyses } from "../../../../../db/schema";
import { analysisVersionsMatch, getAnalysisVersions } from "../../../../../lib/analysis-versions";
import { canonicalizeProfile } from "../../../../../lib/canonical-profile";
import { analyzeStoredJobForProfile } from "../../../../../lib/personalized-analysis";
import { isSafeForDraft } from "../../../../../lib/draft-eligibility";
import { markImmediateDraftFailure, requestImmediateDraftCreation } from "../../../../../lib/gmail-draft-priority";

export const dynamic = "force-dynamic";

async function queueApprovedDraft(input: {
  userId: string;
  job: typeof jobs.$inferSelect;
  versions: ReturnType<typeof getAnalysisVersions>;
  analysis: { verdict: string; label: string; blocker: string | null; rows: string; matchingSkills: string; missingSkills: string; source: "rules" };
  now: Date;
}) {
  if (!isSafeForDraft({ verdict: input.analysis.verdict, contactEmail: input.job.contactEmail, sourceId: input.job.sourceId })) return { queued: false, created: 0, sent: 0 };
  const db = getDb();
  const existingOutbox = await db.select({ id: draftOutbox.id }).from(draftOutbox)
    .where(and(eq(draftOutbox.userId, input.userId), eq(draftOutbox.jobId, input.job.id))).limit(1).then((rows) => rows[0]);
  if (existingOutbox) return { queued: false, created: 0, sent: 0 };

  let history = await db.select({ id: triageHistory.id }).from(triageHistory)
    .where(and(eq(triageHistory.userId, input.userId), eq(triageHistory.jobId, input.job.id), eq(triageHistory.verdict, "✅")))
    .orderBy(desc(triageHistory.createdAt)).limit(1).then((rows) => rows[0]);
  if (!history) {
    const batchId = crypto.randomUUID();
    await db.insert(triageBatches).values({ id: batchId, userId: input.userId, trigger: "manual", scope: "radar-analysis", status: "completed", startedAt: input.now, completedAt: input.now, createdAt: input.now });
    history = { id: crypto.randomUUID() };
    await db.insert(triageHistory).values({ id: history.id, batchId, userId: input.userId, jobId: input.job.id, ...input.versions, verdict: "✅", label: input.analysis.label, blocker: input.analysis.blocker, source: input.analysis.source, confidence: 100, rows: input.analysis.rows, createdAt: input.now });
  }

  const outboxId = crypto.randomUUID();
  await db.insert(draftOutbox).values({ id: outboxId, userId: input.userId, jobId: input.job.id, historyId: history.id, status: "pending", autoSendAuthorized: true, autoSendAuthorizedAt: input.now, createdAt: input.now, updatedAt: input.now });
  const immediate = await requestImmediateDraftCreation([outboxId]);
  if (!immediate.requested) await markImmediateDraftFailure([outboxId], immediate.reason);
  return { queued: true, created: immediate.created ?? 0, sent: immediate.sent ?? 0, reason: immediate.reason };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [row, profile] = await Promise.all([
    db.select().from(userJobAnalyses).where(and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, id))).limit(1).then(rows => rows[0]),
    db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then(rows => rows[0]),
  ]);
  if (!row) return NextResponse.json({ analysis: null });
  if (!profile || !analysisVersionsMatch(row, getAnalysisVersions(canonicalizeProfile(profile)))) {
    return NextResponse.json({ analysis: null, stale: true });
  }
  return NextResponse.json({ analysis: { ...row, rows: JSON.parse(row.rows), matchingSkills: JSON.parse(row.matchingSkills), missingSkills: JSON.parse(row.missingSkills) } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [job, profile, existing] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.id, id)).limit(1).then(rows => rows[0]),
    db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then(rows => rows[0]),
    db.select().from(userJobAnalyses).where(and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, id))).limit(1).then(rows => rows[0]),
  ]);
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de registrar análises" }, { status: 412 });

  const result = analyzeStoredJobForProfile(job, profile);
  if (!result) return NextResponse.json({ error: "Cadastre suas competências antes de registrar análises" }, { status: 412 });
  if (!result.eligible) {
    await db.delete(userJobAnalyses).where(and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, id)));
    return NextResponse.json({ error: "Apenas vagas com veredito Bate ou Provável são registradas", verdict: result.verdict }, { status: 422 });
  }

  const now = new Date();
  const versions = getAnalysisVersions(canonicalizeProfile(profile));
  const values = {
    userId: user.userId,
    jobId: id,
    profileVersion: profile.updatedAt,
    ...versions,
    verdict: result.verdict.emoji,
    label: result.verdict.label,
    blocker: result.verdict.blocker ?? null,
    rows: JSON.stringify(result.verdict.rows),
    matchingSkills: JSON.stringify(result.stackFit.matchingSkills),
    missingSkills: JSON.stringify(result.stackFit.missingSkills),
    source: "rules" as const,
    confidence: 100,
    explanation: null,
    createdAt: now,
    updatedAt: now,
  };
  const unchanged = existing
    && analysisVersionsMatch(existing, values)
    && existing.verdict === values.verdict
    && existing.label === values.label
    && existing.blocker === values.blocker
    && existing.rows === values.rows
    && existing.matchingSkills === values.matchingSkills
    && existing.missingSkills === values.missingSkills;
  if (unchanged) {
    const draft = await queueApprovedDraft({ userId: user.userId, job, versions, analysis: values, now });
    return NextResponse.json({ ok: true, persisted: true, changed: false, draft, analysis: { ...existing, rows: result.verdict.rows, matchingSkills: result.stackFit.matchingSkills, missingSkills: result.stackFit.missingSkills } });
  }
  await db.insert(userJobAnalyses).values(values).onConflictDoUpdate({
    target: [userJobAnalyses.userId, userJobAnalyses.jobId],
    set: {
      profileVersion: values.profileVersion,
      profileRevision: values.profileRevision,
      rulesRevision: values.rulesRevision,
      instructionsRevision: values.instructionsRevision,
      verdict: values.verdict,
      label: values.label,
      blocker: values.blocker,
      rows: values.rows,
      matchingSkills: values.matchingSkills,
      missingSkills: values.missingSkills,
      source: values.source,
      confidence: values.confidence,
      explanation: values.explanation,
      updatedAt: values.updatedAt,
    },
  });
  const draft = await queueApprovedDraft({ userId: user.userId, job, versions, analysis: values, now });
  return NextResponse.json({ ok: true, persisted: true, changed: true, draft, analysis: { ...values, rows: result.verdict.rows, matchingSkills: result.stackFit.matchingSkills, missingSkills: result.stackFit.missingSkills } });
}
