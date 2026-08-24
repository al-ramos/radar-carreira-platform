import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/index";
import { draftOutbox, jobs, platformSettings, profiles, triageBatches, triageHistory, userJobAnalyses } from "../db/schema";
import { canonicalizeProfile } from "./canonical-profile";
import { getAnalysisVersions } from "./analysis-versions";
import { evaluateDeterministicTriage } from "./deterministic-triage";
import { isSafeForDraft } from "./draft-eligibility";
import { requestImmediateDraftCreation } from "./gmail-draft-priority";

const LABELS: Record<string, string> = { "✅": "Aprovada", "🟡": "Provável com ressalvas", "🔴": "Não bate", "❌": "Bloqueador estrutural" };

export type AiVerdictEntry = { jobId: string; verdict: "✅" | "🟡" | "🔴" | "❌"; note?: string };

function parseStackSafe(value: string): string[] {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

/**
 * Aplica vereditos vindos de uma leitura de IA (nuvem ou Codex) como veredito
 * oficial da vaga — mesma trilha usada pela reimportação de CSV
 * (/api/admin/triage-import). Decisão explícita do proprietário: a partir de
 * uma análise por IA considerada válida, ✅ pode criar rascunho imediatamente
 * quando houver e-mail válido; 🟡, 🔴 e ❌ ficam apenas no histórico.
 */
export async function applyAiVerdicts(userId: string, batchScope: string, entries: AiVerdictEntry[]): Promise<{ applied: number; draftsQueued: number; draftsCreated: number }> {
  if (!entries.length) return { applied: 0, draftsQueued: 0, draftsCreated: 0 };
  const db = getDb();
  const profile = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1).then((r) => r[0]);
  if (!profile) return { applied: 0, draftsQueued: 0, draftsCreated: 0 };
  const canonicalProfile = canonicalizeProfile(profile);
  const versions = getAnalysisVersions(canonicalProfile);
  const now = new Date();
  const batchId = randomUUID();
  await db.insert(triageBatches).values({ id: batchId, userId, trigger: "manual", scope: batchScope, status: "running", startedAt: now, createdAt: now });

  const settings = await db.select({ draftQueueEnabled: platformSettings.scheduledTriageDraftQueueEnabled, autoCreateEnabled: platformSettings.scheduledTriageAutoCreateEnabled })
    .from(platformSettings).where(eq(platformSettings.id, "global")).limit(1).then((rows) => rows[0]);
  const draftQueueEnabled = settings?.draftQueueEnabled ?? true;
  const autoCreateEnabled = draftQueueEnabled && (settings?.autoCreateEnabled ?? true);
  const pendingOutboxIds: string[] = [];
  let applied = 0, draftsQueued = 0;
  for (const entry of entries) {
    const job = await db.select().from(jobs).where(eq(jobs.id, entry.jobId)).limit(1).then((r) => r[0]);
    if (!job) continue;
    const historyId = randomUUID();
    const label = LABELS[entry.verdict];
    const blocker = entry.verdict === "❌" ? (entry.note || label) : null;
    const historyRows = JSON.stringify({ source: batchScope, note: entry.note ?? "" });
    await db.insert(triageHistory).values({ id: historyId, batchId, userId, jobId: job.id, ...versions, verdict: entry.verdict, label, blocker, source: "ai", confidence: 100, rows: historyRows, createdAt: now });
    await db.insert(userJobAnalyses).values({ userId, jobId: job.id, profileVersion: profile.updatedAt, ...versions, verdict: entry.verdict, label, blocker, rows: historyRows, matchingSkills: "[]", missingSkills: "[]", source: "ai", confidence: 100, explanation: entry.note || null, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [userJobAnalyses.userId, userJobAnalyses.jobId],
        set: { profileVersion: profile.updatedAt, ...versions, verdict: entry.verdict, label, blocker, rows: historyRows, source: "ai", confidence: 100, explanation: entry.note || null, updatedAt: now },
      });
    applied += 1;

    if (draftQueueEnabled && entry.verdict === "✅") {
      const deterministic = evaluateDeterministicTriage({ ...job, stack: parseStackSafe(job.stack) }, canonicalProfile);
      if (isSafeForDraft({ verdict: entry.verdict, contactEmail: job.contactEmail, sourceId: job.sourceId, blocker, deterministicVerdict: deterministic.verdict, deterministicBlocker: deterministic.blocker })) {
        const outboxId = randomUUID();
        const inserted = await db.insert(draftOutbox).values({ id: outboxId, userId, jobId: job.id, historyId, status: "pending", createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ id: draftOutbox.id });
        if (inserted.length) { draftsQueued += 1; pendingOutboxIds.push(outboxId); }
      }
    }
  }
  await db.update(triageBatches).set({ status: "completed", completedAt: new Date() }).where(eq(triageBatches.id, batchId));
  let immediateDraft: { created?: number } | null = null;
  if (autoCreateEnabled && pendingOutboxIds.length) {
    try { immediateDraft = await requestImmediateDraftCreation(pendingOutboxIds); } catch { /* a fila pending permite nova tentativa manual */ }
  }
  return { applied, draftsQueued, draftsCreated: immediateDraft?.created ?? 0 };
}
