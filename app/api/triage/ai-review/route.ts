import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { aiUsageEvents, jobs, profiles, triageAiReviews, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { reviewSelectedJobs, getAiProviderStatus } from "../../../../lib/ai-provider";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { normalizeCareerRules } from "../../../../lib/profile-options";

export const dynamic = "force-dynamic";
const MAX_AI_REVIEW_JOBS = 20;
const RESERVED_OUTPUT_TOKENS = 1800;
const channels = new Set(["extension", "email", "connector", "file", "api"]);

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId.trim() : "";
  const homePeriod = typeof body?.homePeriod === "string" ? body.homePeriod : "24";
  const roleArea = typeof body?.roleArea === "string" ? body.roleArea.trim() : "";
  const ingestionChannel = typeof body?.ingestionChannel === "string" ? body.ingestionChannel.trim() : "";
  const includeTriaged = body?.includeTriaged === true;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (!sourceId || sourceId === "all") return NextResponse.json({ error: "Selecione uma fonte antes de pedir a análise." }, { status: 400 });
  if (!["24", "72", "168", "all"].includes(homePeriod)) return NextResponse.json({ error: "Período inválido" }, { status: 400 });
  if (ingestionChannel && !channels.has(ingestionChannel)) return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  if (prompt.length < 8) return NextResponse.json({ error: "Descreva o que você quer que a IA avalie." }, { status: 400 });

  const db = getDb();
  const profile = await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then(rows => rows[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de solicitar uma análise." }, { status: 412 });
  const cutoff = homePeriod === "all" ? null : new Date(Date.now() - Number(homePeriod) * 36e5);
  const selected = await db.select({ id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location, url: jobs.url, description: jobs.description, publishedAt: jobs.publishedAt })
    .from(jobs)
    .leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, user.userId), eq(userJobAnalyses.jobId, jobs.id)))
    .where(and(eq(jobs.status, "active"), eq(jobs.sourceId, sourceId), cutoff ? gte(jobs.publishedAt, cutoff) : undefined, roleArea && roleArea !== "all" ? eq(jobs.roleArea, roleArea) : undefined, ingestionChannel ? eq(jobs.ingestionChannel, ingestionChannel as "extension" | "email" | "connector" | "file" | "api") : undefined, includeTriaged ? undefined : isNull(userJobAnalyses.jobId)))
    .orderBy(desc(jobs.firstSeenAt), desc(jobs.createdAt))
    .limit(MAX_AI_REVIEW_JOBS + 1);
  if (!selected.length) return NextResponse.json({ error: "Nenhuma vaga corresponde ao recorte atual." }, { status: 404 });
  if (selected.length > MAX_AI_REVIEW_JOBS) return NextResponse.json({ error: `A análise com IA aceita até ${MAX_AI_REVIEW_JOBS} vagas por vez. Refine Área, Canal ou Período.` }, { status: 422 });

  const canonicalProfile = canonicalizeProfile(profile);
  const reviewJobs = selected.map(job => ({ id: job.id, title: job.title, company: job.company, location: job.location, url: job.url, description: job.description.slice(0, 3200) }));
  const selection = { filters: { sourceId, homePeriod, roleArea: roleArea || "all", ingestionChannel: ingestionChannel || "all", includeTriaged }, jobs: reviewJobs.map(({ description, ...job }) => ({ ...job, description })) };
  const now = new Date();
  const reviewId = randomUUID();
  const status = getAiProviderStatus();
  if (!status.configured) return NextResponse.json({ error: "A IA ainda não está configurada no ambiente de produção." }, { status: 503 });
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const usage = await db.select({ total: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens} + ${aiUsageEvents.outputTokens}), 0)` }).from(aiUsageEvents).where(and(eq(aiUsageEvents.userId, user.userId), gte(aiUsageEvents.createdAt, monthStart))).then(rows => Number(rows[0]?.total ?? 0));
  const estimatedInput = Math.ceil((JSON.stringify(selection).length + prompt.length + JSON.stringify(canonicalProfile).length) / 4);
  const rules = normalizeCareerRules(profile.careerRules);
  if (usage + estimatedInput + RESERVED_OUTPUT_TOKENS > rules.aiMonthlyTokenLimit) {
    await db.insert(triageAiReviews).values({ id: reviewId, userId: user.userId, prompt, selection: JSON.stringify(selection), status: "blocked", error: "Limite mensal de IA atingido", createdAt: now });
    await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: user.userId, operation: "review_selection", provider: status.provider ?? "unknown", model: status.model ?? "unknown", status: "blocked_budget", createdAt: now });
    return NextResponse.json({ error: "Limite mensal de IA atingido." }, { status: 429 });
  }
  await db.insert(triageAiReviews).values({ id: reviewId, userId: user.userId, prompt, selection: JSON.stringify(selection), createdAt: now });
  try {
    const completion = await reviewSelectedJobs({ instruction: prompt, profile: canonicalProfile, jobs: reviewJobs });
    await db.update(triageAiReviews).set({ response: completion.value, status: "completed", provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens }).where(eq(triageAiReviews.id, reviewId));
    await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: user.userId, operation: "review_selection", provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, status: "completed", createdAt: now });
    return NextResponse.json({ id: reviewId, response: completion.value, jobs: reviewJobs.map((job) => ({ id: job.id, title: job.title, company: job.company })), provider: completion.provider, model: completion.model });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 1000) : "Falha ao consultar IA";
    await db.update(triageAiReviews).set({ status: "failed", error: detail, provider: status.provider, model: status.model }).where(eq(triageAiReviews.id, reviewId));
    await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: user.userId, operation: "review_selection", provider: status.provider ?? "unknown", model: status.model ?? "unknown", status: "failed", createdAt: now });
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
