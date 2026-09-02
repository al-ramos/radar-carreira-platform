import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { aiUsageEvents, jobs, platformSettings, profiles, triageAiReviewChunks, triageAiReviews } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { getAiProviderStatus, type AiReviewProfile } from "../../../../lib/ai-provider";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { hasTriageableDescription, needsCurrentTriage } from "../../../../lib/current-triage";
import { normalizeCareerRules } from "../../../../lib/profile-options";
import { reserveQueueMessages } from "../../../../lib/queue-quota";

export const dynamic = "force-dynamic";
const MAX_ASYNC_AI_REVIEW_JOBS = 1000, CHUNK_SIZE = 10, RESERVED_OUTPUT_TOKENS = 1800;
const channels = new Set(["extension", "email", "connector", "file", "api"]);
type Queue = { sendBatch(messages: Array<{ body: { kind: "ai-review"; reviewId: string; chunkId: string; action: "chunk" } }>): Promise<void> };
type Job = { id: string; title: string; company: string; location: string | null; url: string; description: string };
const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

export async function GET(request: Request) {
  const user = await getChatGPTUser(); if (!user || !isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id"); if (!id) return NextResponse.json({ error: "Identificador obrigatório" }, { status: 400 });
  const db = getDb(), review = await db.select().from(triageAiReviews).where(and(eq(triageAiReviews.id, id), eq(triageAiReviews.userId, user.userId), eq(triageAiReviews.destination, "portal"))).limit(1).then(rows => rows[0]);
  if (!review) return NextResponse.json({ error: "Análise não encontrada" }, { status: 404 });
  const parts = await db.select({ status: triageAiReviewChunks.status, error: triageAiReviewChunks.error }).from(triageAiReviewChunks).where(eq(triageAiReviewChunks.reviewId, id));
  return NextResponse.json({ id, status: review.status, response: review.response, error: review.error, total: parts.length, completed: parts.filter(part => part.status === "completed").length, failed: parts.filter(part => part.status === "failed").length, provider: review.provider, model: review.model });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser(); if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 }); if (!isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null, sourceId = typeof body?.sourceId === "string" ? body.sourceId.trim() : "", homePeriod = typeof body?.homePeriod === "string" ? body.homePeriod : "24", roleArea = typeof body?.roleArea === "string" ? body.roleArea.trim() : "", ingestionChannelRaw = typeof body?.ingestionChannel === "string" ? body.ingestionChannel.trim() : "", ingestionChannel = ingestionChannelRaw === "all" ? "" : ingestionChannelRaw, prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "", includeTriaged = body?.includeTriaged === true;
  const requestedJobIds = Array.isArray(body?.jobIds) ? body.jobIds.filter((id): id is string => typeof id === "string").slice(0, MAX_ASYNC_AI_REVIEW_JOBS) : null;
  if (!sourceId && !requestedJobIds?.length) return NextResponse.json({ error: "Selecione uma fonte ou vagas antes de pedir a análise." }, { status: 400 });
  if (!["24", "72", "168", "all"].includes(homePeriod) || (ingestionChannel && !channels.has(ingestionChannel)) || prompt.length < 8) return NextResponse.json({ error: "Parâmetros da análise inválidos." }, { status: 400 });
  const db = getDb(), profile = await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then(rows => rows[0]); if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de solicitar uma análise." }, { status: 412 });
  const canonical = canonicalizeProfile(profile), versions = getAnalysisVersions(canonical);
  const cutoff = homePeriod === "all" ? null : new Date(Date.now() - Number(homePeriod) * 36e5);
  const selected = await db.select({ id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location, url: jobs.url, description: jobs.description }).from(jobs).where(and(eq(jobs.status, "active"), hasTriageableDescription(), requestedJobIds?.length ? inArray(jobs.id, requestedJobIds) : sourceId === "all" ? undefined : eq(jobs.sourceId, sourceId), requestedJobIds?.length ? undefined : cutoff ? gte(jobs.firstSeenAt, cutoff) : undefined, roleArea && roleArea !== "all" ? eq(jobs.roleArea, roleArea) : undefined, ingestionChannel ? eq(jobs.ingestionChannel, ingestionChannel as "extension" | "email" | "connector" | "file" | "api") : undefined, includeTriaged || requestedJobIds?.length ? undefined : needsCurrentTriage(user.userId, versions))).orderBy(desc(jobs.firstSeenAt), desc(jobs.createdAt)).limit(MAX_ASYNC_AI_REVIEW_JOBS + 1);
  if (!selected.length) return NextResponse.json({ error: "Nenhuma vaga corresponde ao recorte atual." }, { status: 404 }); if (selected.length > MAX_ASYNC_AI_REVIEW_JOBS) return NextResponse.json({ error: `A análise aceita até ${MAX_ASYNC_AI_REVIEW_JOBS} vagas por solicitação.` }, { status: 422 });
  const reviewProfile: AiReviewProfile = { seniority: canonical.seniority, preferredMode: canonical.preferredMode, masteredSkills: canonical.masteredSkills, desiredAreas: canonical.desiredAreas, avoidTerms: canonical.avoidTerms, minScore: canonical.minScore, careerRules: canonical.careerRules }, reviewJobs: Job[] = selected.map(job => ({ ...job, description: job.description.slice(0, 3200) }));
  const status = getAiProviderStatus(); if (!status.configured) return NextResponse.json({ error: "A IA ainda não está configurada no ambiente de produção." }, { status: 503 });
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0); const usage = await db.select({ total: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens} + ${aiUsageEvents.outputTokens}), 0)` }).from(aiUsageEvents).where(and(eq(aiUsageEvents.userId, user.userId), gte(aiUsageEvents.createdAt, monthStart))).then(rows => Number(rows[0]?.total ?? 0));
  const queueSettings = await db.select({ queueBudget: platformSettings.queueDailyOperationBudget, aiChunkSize: platformSettings.aiReviewChunkSize }).from(platformSettings).where(eq(platformSettings.id, "global")).limit(1).then(rows => rows[0]);
  const groups = chunks(reviewJobs, Math.max(1, Math.min(20, queueSettings?.aiChunkSize ?? CHUNK_SIZE))), estimated = Math.ceil((JSON.stringify({ reviewProfile, reviewJobs }).length + prompt.length) / 4) + RESERVED_OUTPUT_TOKENS * (groups.length + 1), rules = normalizeCareerRules(profile.careerRules); if (usage + estimated > rules.aiMonthlyTokenLimit) return NextResponse.json({ error: "O recorte excede o limite mensal de IA disponível." }, { status: 429 });
  const reviewId = randomUUID(), now = new Date();
  const quota = await reserveQueueMessages(db, "radar-carreira-ai-review", groups.length, Math.max(1000, Math.min(10000, queueSettings?.queueBudget ?? 7500)));
  if (!quota.allowed) return NextResponse.json({ error: `A proteção da cota diária das filas bloqueou a análise. Tente novamente após ${quota.resetAt}.`, resetAt: quota.resetAt }, { status: 429 });
  await db.insert(triageAiReviews).values({ id: reviewId, userId: user.userId, prompt, selection: JSON.stringify({ profile: reviewProfile, jobs: reviewJobs }), status: "queued", destination: "portal", createdAt: now });
  const parts = groups.map((group, chunkIndex) => ({ id: randomUUID(), reviewId, chunkIndex, selection: JSON.stringify({ jobs: group }), status: "queued" as const, attemptCount: 0, createdAt: now, updatedAt: now })); await db.insert(triageAiReviewChunks).values(parts);
  const queue = (env as { AI_REVIEW_QUEUE?: Queue }).AI_REVIEW_QUEUE; if (!queue) return NextResponse.json({ error: "Fila de análise de IA indisponível." }, { status: 503 });
  try { await queue.sendBatch(parts.map(part => ({ body: { kind: "ai-review" as const, reviewId, chunkId: part.id, action: "chunk" as const } }))); } catch (error) { const detail = error instanceof Error ? error.message : "Falha ao enfileirar análise"; await db.update(triageAiReviews).set({ status: "failed", error: detail }).where(eq(triageAiReviews.id, reviewId)); return NextResponse.json({ error: detail }, { status: 503 }); }
  return NextResponse.json({ id: reviewId, status: "queued", queued: reviewJobs.length, chunks: parts.length }, { status: 202 });
}
