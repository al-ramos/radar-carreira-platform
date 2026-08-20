import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { draftOutbox, jobs, profiles, triageHistory } from "../../../../../db/schema";
import { getAnalysisVersions } from "../../../../../lib/analysis-versions";
import { canonicalizeProfile, profileIsReadyForTriage } from "../../../../../lib/canonical-profile";
import { isEligibleForDraftQueue } from "../../../../../lib/draft-eligibility";

export const dynamic = "force-dynamic";

/**
 * Reserva a fila persistente para o futuro criador de rascunhos. Não conversa
 * com Gmail e nunca envia e-mail. O perfil canônico é relido nesta requisição,
 * e somente análises da mesma versão entram na fila.
 */
export async function POST() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const db = getDb();
  const profile = await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1).then((rows) => rows[0]);
  if (!profile) return NextResponse.json({ error: "Complete seu perfil antes de preparar rascunhos." }, { status: 412 });

  const canonicalProfile = canonicalizeProfile(profile);
  if (!profileIsReadyForTriage(canonicalProfile)) return NextResponse.json({ error: "O perfil técnico ainda não está pronto para triagem." }, { status: 412 });
  const versions = getAnalysisVersions(canonicalProfile);
  const [historyRows, existingOutbox] = await Promise.all([
    db.select({
      id: triageHistory.id,
      jobId: triageHistory.jobId,
      verdict: triageHistory.verdict,
      profileRevision: triageHistory.profileRevision,
      rulesRevision: triageHistory.rulesRevision,
      instructionsRevision: triageHistory.instructionsRevision,
      contactEmail: jobs.contactEmail,
    })
      .from(triageHistory)
      .innerJoin(jobs, eq(triageHistory.jobId, jobs.id))
      .where(eq(triageHistory.userId, user.userId))
      .orderBy(desc(triageHistory.createdAt)),
    db.select({ jobId: draftOutbox.jobId, status: draftOutbox.status }).from(draftOutbox).where(eq(draftOutbox.userId, user.userId)),
  ]);

  const alreadyQueued = new Set(existingOutbox.map((row) => row.jobId));
  const latestByJob = new Map<string, typeof historyRows[number]>();
  for (const row of historyRows) if (!latestByJob.has(row.jobId)) latestByJob.set(row.jobId, row);

  const now = new Date();
  const queued: string[] = [];
  let noValidContact = 0;
  let notEligible = 0;
  let outdated = 0;
  let alreadyPresent = 0;
  for (const row of latestByJob.values()) {
    if (alreadyQueued.has(row.jobId)) { alreadyPresent += 1; continue; }
    const sameVersion = row.profileRevision === versions.profileRevision && row.rulesRevision === versions.rulesRevision && row.instructionsRevision === versions.instructionsRevision;
    if (!sameVersion) { outdated += 1; continue; }
    if (row.verdict !== "✅" && row.verdict !== "🟡") { notEligible += 1; continue; }
    if (!isEligibleForDraftQueue(row)) { noValidContact += 1; continue; }
    await db.insert(draftOutbox).values({ id: crypto.randomUUID(), userId: user.userId, jobId: row.jobId, historyId: row.id, status: "pending", createdAt: now, updatedAt: now });
    queued.push(row.jobId);
  }

  return NextResponse.json({ ok: true, queued: queued.length, noValidContact, notEligible, outdated, alreadyPresent, gmailDraftsCreated: 0 });
}
