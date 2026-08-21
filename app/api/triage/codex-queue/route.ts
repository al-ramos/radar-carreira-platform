import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { jobs, profiles, triageAiReviews, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";

export const dynamic = "force-dynamic";
const MAX_CODEX_REVIEW_JOBS = 20;
const channels = new Set(["extension", "email", "connector", "file", "api"]);

async function owner() {
  const user = await getChatGPTUser();
  if (!user) return { error: NextResponse.json({ error: "Autenticação necessária" }, { status: 401 }) };
  if (!isOwnerEmail(user.email)) return { error: NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 }) };
  return { user };
}

export async function GET(request: Request) {
  const auth = await owner();
  if ("error" in auth) return auth.error;
  const state = new URL(request.url).searchParams.get("state") ?? "pending";
  if (!["pending", "claimed", "completed", "failed", "all"].includes(state)) return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  const rows = await getDb().select({
    id: triageAiReviews.id, prompt: triageAiReviews.prompt, selection: triageAiReviews.selection, status: triageAiReviews.codexStatus,
    createdAt: triageAiReviews.createdAt, claimedAt: triageAiReviews.codexClaimedAt, completedAt: triageAiReviews.codexCompletedAt, error: triageAiReviews.error,
  }).from(triageAiReviews).where(and(eq(triageAiReviews.userId, auth.user.userId), eq(triageAiReviews.destination, "codex"), state === "all" ? undefined : eq(triageAiReviews.codexStatus, state as "pending" | "claimed" | "completed" | "failed"))).orderBy(desc(triageAiReviews.createdAt)).limit(30);
  return NextResponse.json({ items: rows.map((row) => ({ ...row, selection: JSON.parse(row.selection) })) });
}

export async function POST(request: Request) {
  const auth = await owner();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId.trim() : "";
  const homePeriod = typeof body?.homePeriod === "string" ? body.homePeriod : "24";
  const roleArea = typeof body?.roleArea === "string" ? body.roleArea.trim() : "";
  const ingestionChannel = typeof body?.ingestionChannel === "string" ? body.ingestionChannel.trim() : "";
  const includeTriaged = body?.includeTriaged === true;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (!sourceId || sourceId === "all") return NextResponse.json({ error: "Selecione uma fonte antes de preparar a análise." }, { status: 400 });
  if (!["24", "72", "168", "all"].includes(homePeriod)) return NextResponse.json({ error: "Período inválido" }, { status: 400 });
  if (ingestionChannel && !channels.has(ingestionChannel)) return NextResponse.json({ error: "Canal inválido" }, { status: 400 });
  if (prompt.length < 8) return NextResponse.json({ error: "Descreva o que você quer que o Codex avalie." }, { status: 400 });

  const db = getDb();
  const profile = await db.select().from(profiles).where(eq(profiles.userId, auth.user.userId)).limit(1).then((rows) => rows[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de preparar uma análise." }, { status: 412 });
  const cutoff = homePeriod === "all" ? null : new Date(Date.now() - Number(homePeriod) * 36e5);
  const selected = await db.select({ id: jobs.id, title: jobs.title, company: jobs.company, location: jobs.location, url: jobs.url, description: jobs.description })
    .from(jobs).leftJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, auth.user.userId), eq(userJobAnalyses.jobId, jobs.id)))
    .where(and(eq(jobs.status, "active"), eq(jobs.sourceId, sourceId), cutoff ? gte(jobs.firstSeenAt, cutoff) : undefined, roleArea && roleArea !== "all" ? eq(jobs.roleArea, roleArea) : undefined, ingestionChannel ? eq(jobs.ingestionChannel, ingestionChannel as "extension" | "email" | "connector" | "file" | "api") : undefined, includeTriaged ? undefined : isNull(userJobAnalyses.jobId)))
    .orderBy(desc(jobs.firstSeenAt), desc(jobs.createdAt)).limit(MAX_CODEX_REVIEW_JOBS + 1);
  if (!selected.length) return NextResponse.json({ error: "Nenhuma vaga corresponde ao recorte atual." }, { status: 404 });
  if (selected.length > MAX_CODEX_REVIEW_JOBS) return NextResponse.json({ error: `A análise pelo Codex aceita até ${MAX_CODEX_REVIEW_JOBS} vagas por vez. Refine Área, Canal ou Período.` }, { status: 422 });

  const selection = {
    filters: { sourceId, homePeriod, roleArea: roleArea || "all", ingestionChannel: ingestionChannel || "all", includeTriaged },
    profile: canonicalizeProfile(profile),
    jobs: selected.map((job) => ({ ...job, description: job.description.slice(0, 3200) })),
  };
  const id = randomUUID();
  await db.insert(triageAiReviews).values({ id, userId: auth.user.userId, prompt, selection: JSON.stringify(selection), status: "completed", destination: "codex", codexStatus: "pending", createdAt: new Date() });
  return NextResponse.json({ id, queued: selected.length, status: "pending" }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await owner();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const action = body?.action;
  if (!id || !["claim", "complete", "fail"].includes(String(action))) return NextResponse.json({ error: "Ação de fila inválida" }, { status: 400 });
  const now = new Date();
  const set = action === "claim" ? { codexStatus: "claimed" as const, codexClaimedAt: now } : action === "complete" ? { codexStatus: "completed" as const, codexCompletedAt: now } : { codexStatus: "failed" as const, codexCompletedAt: now, error: typeof body?.error === "string" ? body.error.slice(0, 1000) : "Falha na análise pelo Codex" };
  await getDb().update(triageAiReviews).set(set).where(and(eq(triageAiReviews.id, id), eq(triageAiReviews.userId, auth.user.userId), eq(triageAiReviews.destination, "codex")));
  return NextResponse.json({ id, status: set.codexStatus });
}
