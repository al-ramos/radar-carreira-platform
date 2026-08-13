import { createHash, randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { aiUsageEvents, jobAiFacts, jobs, profiles } from "../../../../../db/schema";
import { extractStructuredJobFacts, getAiProviderStatus, validateStructuredJobFacts } from "../../../../../lib/ai-provider";
import { analyzeStoredJobForProfile } from "../../../../../lib/personalized-analysis";
import { buildInterviewBrief } from "../../../../../lib/job-intelligence";
import { normalizeCareerRules } from "../../../../../lib/profile-options";

export const dynamic = "force-dynamic";
const ANALYZER_VERSION = "job-facts-v1";
const RESERVED_OUTPUT_TOKENS = 1200;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const [job, profile] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.id, id)).limit(1).then(rows => rows[0]),
    db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then(rows => rows[0]),
  ]);
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de usar a IA" }, { status: 412 });
  const descriptionHash = createHash("sha256").update(`${job.title}\n${job.company}\n${job.description}`).digest("hex");
  const cached = await db.select().from(jobAiFacts).where(eq(jobAiFacts.jobId, id)).limit(1).then(rows => rows[0]);
  const personalized = analyzeStoredJobForProfile(job, profile);
  const rules = normalizeCareerRules(profile.careerRules);
  if (cached?.descriptionHash === descriptionHash && cached.analyzerVersion === ANALYZER_VERSION) {
    const facts = validateStructuredJobFacts(JSON.parse(cached.facts));
    return NextResponse.json({ facts, interview: buildInterviewBrief(facts, rules, personalized?.stackFit.missingSkills ?? []), cached: true, provider: cached.provider, model: cached.model });
  }
  const status = getAiProviderStatus();
  if (!status.configured) return NextResponse.json({ error: "A IA ainda não está configurada no ambiente de produção. As regras locais continuam ativas." }, { status: 503 });
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const usage = await db.select({ total: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens} + ${aiUsageEvents.outputTokens}), 0)` }).from(aiUsageEvents).where(and(eq(aiUsageEvents.userId, user.userId), gte(aiUsageEvents.createdAt, monthStart))).then(rows => Number(rows[0]?.total ?? 0));
  const estimatedInput = Math.ceil((job.description.length + job.title.length + job.company.length) / 4);
  if (usage + estimatedInput + RESERVED_OUTPUT_TOKENS > rules.aiMonthlyTokenLimit) {
    await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: user.userId, jobId: id, operation: "resolve_ambiguity", provider: status.provider ?? "unknown", model: status.model ?? "unknown", status: "blocked_budget", createdAt: new Date() });
    return NextResponse.json({ error: "Limite mensal de IA atingido. A análise pelas regras continua disponível." }, { status: 429 });
  }
  try {
    const completion = await extractStructuredJobFacts({ title: job.title, company: job.company, location: job.location, url: job.url, description: job.description });
    const now = new Date();
    await db.insert(jobAiFacts).values({ jobId: id, descriptionHash, analyzerVersion: ANALYZER_VERSION, facts: JSON.stringify(completion.value), provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, analyzedAt: now }).onConflictDoUpdate({ target: jobAiFacts.jobId, set: { descriptionHash, analyzerVersion: ANALYZER_VERSION, facts: JSON.stringify(completion.value), provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, analyzedAt: now } });
    await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: user.userId, jobId: id, operation: "resolve_ambiguity", provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, status: "completed", createdAt: now });
    return NextResponse.json({ facts: completion.value, interview: buildInterviewBrief(completion.value, rules, personalized?.stackFit.missingSkills ?? []), cached: false, provider: completion.provider, model: completion.model });
  } catch (error) {
    await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: user.userId, jobId: id, operation: "resolve_ambiguity", provider: status.provider ?? "unknown", model: status.model ?? "unknown", status: "failed", createdAt: new Date() });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar a IA" }, { status: 502 });
  }
}
