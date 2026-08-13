import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobs, profiles, userJobAnalyses } from "../../../../../db/schema";
import { analyzeStoredJobForProfile } from "../../../../../lib/personalized-analysis";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [row, profile] = await Promise.all([
    db.select().from(userJobAnalyses).where(and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, id))).limit(1).then(rows => rows[0]),
    db.select({ updatedAt: profiles.updatedAt }).from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then(rows => rows[0]),
  ]);
  if (!row) return NextResponse.json({ analysis: null });
  if (!profile || row.profileVersion.getTime() !== profile.updatedAt.getTime()) {
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
  const values = {
    userId: user.userId,
    jobId: id,
    profileVersion: profile.updatedAt,
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
    && existing.profileVersion.getTime() === values.profileVersion.getTime()
    && existing.verdict === values.verdict
    && existing.label === values.label
    && existing.blocker === values.blocker
    && existing.rows === values.rows
    && existing.matchingSkills === values.matchingSkills
    && existing.missingSkills === values.missingSkills;
  if (unchanged) {
    return NextResponse.json({ ok: true, persisted: true, changed: false, analysis: { ...existing, rows: result.verdict.rows, matchingSkills: result.stackFit.matchingSkills, missingSkills: result.stackFit.missingSkills } });
  }
  await db.insert(userJobAnalyses).values(values).onConflictDoUpdate({
    target: [userJobAnalyses.userId, userJobAnalyses.jobId],
    set: {
      profileVersion: values.profileVersion,
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
  return NextResponse.json({ ok: true, persisted: true, changed: true, analysis: { ...values, rows: result.verdict.rows, matchingSkills: result.stackFit.matchingSkills, missingSkills: result.stackFit.missingSkills } });
}
