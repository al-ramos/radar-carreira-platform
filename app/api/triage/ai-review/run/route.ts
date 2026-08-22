import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "../../../../../db/index";
import { aiUsageEvents, triageAiReviewChunks, triageAiReviews } from "../../../../../db/schema";
import { reviewSelectedJobs, type AiReviewProfile } from "../../../../../lib/ai-provider";
import { applyAiVerdicts } from "../../../../../lib/apply-ai-verdict";

export const dynamic = "force-dynamic";
type Job = { id: string; title: string; company: string; location: string | null; url: string; description: string };

export async function POST(request: Request) {
  if (request.headers.get("x-radar-ai-review-authenticated") !== "1") return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  const body = await request.json().catch(() => null) as { reviewId?: string; chunkId?: string; action?: string } | null;
  if (!body?.reviewId || !body.chunkId || body.action !== "chunk") return NextResponse.json({ error: "Mensagem de fila inválida" }, { status: 400 });
  const db = getDb(), review = await db.select().from(triageAiReviews).where(eq(triageAiReviews.id, body.reviewId)).limit(1).then(rows => rows[0]), chunk = await db.select().from(triageAiReviewChunks).where(and(eq(triageAiReviewChunks.id, body.chunkId), eq(triageAiReviewChunks.reviewId, body.reviewId))).limit(1).then(rows => rows[0]);
  if (!review || !chunk) return NextResponse.json({ error: "Análise não encontrada" }, { status: 404 });
  if (chunk.status === "completed") return NextResponse.json({ ok: true });
  const now = new Date(); await db.update(triageAiReviews).set({ status: "running" }).where(eq(triageAiReviews.id, review.id)); await db.update(triageAiReviewChunks).set({ status: "processing", attemptCount: chunk.attemptCount + 1, updatedAt: now }).where(eq(triageAiReviewChunks.id, chunk.id));
  try {
    const header = JSON.parse(review.selection) as { profile: AiReviewProfile }, part = JSON.parse(chunk.selection) as { jobs: Job[] };
    const completion = await reviewSelectedJobs({ instruction: `${review.prompt}\n\nResponda de modo conciso: uma seção por vaga, seguida de prioridades do lote.`, profile: header.profile, jobs: part.jobs });
    await db.update(triageAiReviewChunks).set({ status: "completed", response: completion.value.narrative, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, updatedAt: new Date() }).where(eq(triageAiReviewChunks.id, chunk.id));
    await db.insert(aiUsageEvents).values({ id: randomUUID(), userId: review.userId, operation: "review_selection", provider: completion.provider, model: completion.model, inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, status: "completed", createdAt: new Date() });
    // Decisão explícita do proprietário: o veredito da IA já é aplicado como
    // oficial (✅/🟡 liberam rascunho), mesma trilha da reimportação de CSV.
    await applyAiVerdicts(review.userId, "ai-review", completion.value.verdicts);
    const all = await db.select().from(triageAiReviewChunks).where(eq(triageAiReviewChunks.reviewId, review.id));
    if (all.every(item => item.status === "completed" || item.status === "failed")) {
      const succeeded = all.filter(item => item.status === "completed"), failed = all.filter(item => item.status === "failed"), response = succeeded.map((item, index) => `## Lote ${index + 1}\n${item.response ?? ""}`).join("\n\n");
      await db.update(triageAiReviews).set({ status: failed.length ? "partial_failed" : "completed", response, error: failed.length ? `${failed.length} lote(s) não puderam ser analisados.` : null, provider: completion.provider, model: completion.model, inputTokens: all.reduce((sum, item) => sum + item.inputTokens, 0), outputTokens: all.reduce((sum, item) => sum + item.outputTokens, 0) }).where(eq(triageAiReviews.id, review.id));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 1000) : "Falha ao consultar IA";
    await db.update(triageAiReviewChunks).set({ status: "failed", error: detail, updatedAt: new Date() }).where(eq(triageAiReviewChunks.id, chunk.id));
    const remaining = await db.select({ status: triageAiReviewChunks.status }).from(triageAiReviewChunks).where(eq(triageAiReviewChunks.reviewId, review.id));
    if (remaining.every(item => item.status === "completed" || item.status === "failed")) await db.update(triageAiReviews).set({ status: "partial_failed", error: "Um ou mais lotes falharam." }).where(eq(triageAiReviews.id, review.id));
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}
