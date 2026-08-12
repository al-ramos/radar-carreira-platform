import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobs, profiles, userJobAnalyses } from "../../../../../db/schema";
import type { VerdictEmoji, VerdictRow } from "../../../../../lib/verdict";

export const dynamic = "force-dynamic";
const VERDICTS = new Set<VerdictEmoji>(["✅", "🟡", "🔴", "❌"]);
const safeList = (value: unknown) => Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 100) as string[] : [];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const { id } = await params;
  const row = (await getDb().select().from(userJobAnalyses).where(and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, id))).limit(1))[0];
  if (!row) return NextResponse.json({ analysis: null });
  return NextResponse.json({ analysis: { ...row, rows: JSON.parse(row.rows), matchingSkills: JSON.parse(row.matchingSkills), missingSkills: JSON.parse(row.missingSkills) } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { verdict?: VerdictEmoji; label?: string; blocker?: string; rows?: VerdictRow[]; matchingSkills?: string[]; missingSkills?: string[] } | null;
  if (!body?.verdict || !VERDICTS.has(body.verdict) || !body.label) return NextResponse.json({ error: "Análise inválida" }, { status: 400 });
  const db = getDb();
  const [job, profile] = await Promise.all([
    db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id)).limit(1).then(rows => rows[0]),
    db.select({ updatedAt: profiles.updatedAt }).from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then(rows => rows[0]),
  ]);
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  const now = new Date();
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 30).map(row => ({ criterion: String(row.criterion).slice(0, 120), status: String(row.status).slice(0, 500), ok: row.ok === null ? null : Boolean(row.ok) })) : [];
  const values = {
    userId: user.userId, jobId: id, profileVersion: profile?.updatedAt ?? now,
    verdict: body.verdict, label: body.label.slice(0, 120), blocker: body.blocker?.slice(0, 500) || null,
    rows: JSON.stringify(rows), matchingSkills: JSON.stringify(safeList(body.matchingSkills)), missingSkills: JSON.stringify(safeList(body.missingSkills)),
    source: "rules" as const, confidence: 100, explanation: null, createdAt: now, updatedAt: now,
  };
  await db.insert(userJobAnalyses).values(values).onConflictDoUpdate({
    target: [userJobAnalyses.userId, userJobAnalyses.jobId],
    set: {
      profileVersion: values.profileVersion, verdict: values.verdict, label: values.label, blocker: values.blocker,
      rows: values.rows, matchingSkills: values.matchingSkills, missingSkills: values.missingSkills,
      source: values.source, confidence: values.confidence, explanation: values.explanation, updatedAt: values.updatedAt,
    },
  });
  return NextResponse.json({ ok: true, analysis: { ...values, rows, matchingSkills: safeList(body.matchingSkills), missingSkills: safeList(body.missingSkills) } });
}
