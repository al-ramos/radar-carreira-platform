import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobs, profiles, triageBatches, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { isOwnerEmail } from "../../../../lib/access";
import { canonicalizeProfile } from "../../../../lib/canonical-profile";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";
import { isSafeForDraft } from "../../../../lib/draft-eligibility";
import { parseCsvTriageImport } from "../../../../lib/csv-triage-import";
import { markImmediateDraftFailure, requestImmediateDraftCreation } from "../../../../lib/gmail-draft-priority";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = { "✅": "Aprovada", "🟡": "Provável com ressalvas", "🔴": "Não bate", "❌": "Bloqueador estrutural" };
const MAX_ROWS = 2000;
const MAX_BYTES = 2_000_000;

/**
 * Reimporta uma análise externa (código, status, descrição) de volta para o
 * Radar. O veredito importado SUBSTITUI o veredito da vaga — decisão
 * explícita do proprietário — e segue o mesmo caminho de um veredito normal:
 * pode entrar na fila de rascunho se a checagem de segurança
 * (isSafeForDraft) permitir. Esta rota usa sua própria trilha de aplicação;
 * /api/triage/ai-review e /api/triage/codex-queue usam a mesma lógica via
 * lib/apply-ai-verdict.ts.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  if (!isOwnerEmail(user.email)) return NextResponse.json({ error: "Acesso restrito ao proprietário" }, { status: 403 });

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("text/csv")) return NextResponse.json({ error: "Envie um arquivo CSV (content-type text/csv)." }, { status: 400 });
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "Arquivo CSV excede 2 MB." }, { status: 400 });

  const { rows, rejected } = parseCsvTriageImport(text);
  if (!rows.length) return NextResponse.json({ error: "Nenhuma linha válida encontrada. Colunas esperadas: código, status ou veredito final, detalhe do veredito.", rejected }, { status: 400 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `O limite é de ${MAX_ROWS} linhas por importação.` }, { status: 400 });

  // A última linha da mesma vaga é a conclusão atualizada da reanálise.
  const finalRowsByExternalId = new Map<string, typeof rows[number]>();
  for (const row of rows) finalRowsByExternalId.set(row.externalId, row);
  const finalRows = [...finalRowsByExternalId.values()];

  const db = getDb();
  const profile = await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((r) => r[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de importar uma análise." }, { status: 412 });
  const canonicalProfile = canonicalizeProfile(profile);
  const versions = getAnalysisVersions(canonicalProfile);
  const batchId = crypto.randomUUID();
  const now = new Date();
  await db.insert(triageBatches).values({ id: batchId, userId: user.userId, trigger: "manual", scope: "csv-import", status: "running", startedAt: now, createdAt: now });

  let applied = 0, draftsQueued = 0;
  const pendingOutboxIds: string[] = [];
  const notFound: string[] = [];
  const ambiguous: string[] = [];
  const errors: Array<{ code: string; error: string }> = [];

  for (const row of finalRows) {
    const matches = await db.select().from(jobs).where(eq(jobs.externalId, row.externalId));
    if (matches.length === 0) { notFound.push(row.externalId); continue; }
    if (matches.length > 1) { ambiguous.push(row.externalId); continue; }
    const job = matches[0];
    try {
      const historyId = crypto.randomUUID();
      const label = LABELS[row.verdict];
      const blocker = row.verdict === "❌" ? (row.description || label) : null;
      const historyRows = JSON.stringify({ source: "csv-import", note: row.description });
      await db.insert(triageHistory).values({
        id: historyId, batchId, userId: user.userId, jobId: job.id, ...versions,
        verdict: row.verdict, label, blocker, source: "ai", confidence: 100, rows: historyRows, createdAt: now,
      });
      await db.insert(userJobAnalyses).values({
        userId: user.userId, jobId: job.id, profileVersion: profile.updatedAt, ...versions,
        verdict: row.verdict, label, blocker, rows: historyRows, matchingSkills: "[]", missingSkills: "[]",
        source: "ai", confidence: 100, explanation: row.description || null, createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: [userJobAnalyses.userId, userJobAnalyses.jobId],
        set: { profileVersion: profile.updatedAt, ...versions, verdict: row.verdict, label, blocker, rows: historyRows, source: "ai", confidence: 100, explanation: row.description || null, updatedAt: now },
      });
      applied += 1;

      if (row.verdict === "✅") {
        if (isSafeForDraft({ verdict: row.verdict, contactEmail: job.contactEmail, sourceId: job.sourceId })) {
          const outboxId = crypto.randomUUID();
          const inserted = await db.insert(draftOutbox).values({ id: outboxId, userId: user.userId, jobId: job.id, historyId, status: "pending", autoSendAuthorized: false, autoSendAuthorizedAt: null, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: draftOutbox.id });
          if (inserted.length) { draftsQueued += 1; pendingOutboxIds.push(outboxId); }
        }
      }
    } catch (error) {
      errors.push({ code: row.externalId, error: error instanceof Error ? error.message : "Falha desconhecida" });
    }
  }

  await db.update(triageBatches).set({ status: "completed", completedAt: new Date() }).where(eq(triageBatches.id, batchId));
  let immediateDraft: { requested: boolean; created?: number; sent?: number; reason?: string } | null = null;
  if (pendingOutboxIds.length) {
    try { immediateDraft = await requestImmediateDraftCreation(pendingOutboxIds); }
    catch (error) { immediateDraft = { requested: false, reason: error instanceof Error ? error.message : "Falha ao acionar o conector Gmail" }; }
  }
  if (immediateDraft && !immediateDraft.requested) await markImmediateDraftFailure(pendingOutboxIds, immediateDraft.reason);
  return NextResponse.json({ ok: true, batchId, received: rows.length, applied, draftsQueued, draftsCreated: immediateDraft?.created ?? 0, emailsSent: immediateDraft?.sent ?? 0, immediateDraft, notFound, ambiguous, rejected, errors });
}
