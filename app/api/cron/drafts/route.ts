import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobSources, jobs, profiles, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";
import { buildApinfoApplicationEmail } from "../../../../lib/application-email";
import { canonicalizeProfile, profileIsReadyForTriage } from "../../../../lib/canonical-profile";
import { hasValidContactEmail } from "../../../../lib/contact-email";

export const dynamic = "force-dynamic";

const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const list = (value: string) => { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } };

async function authenticate(request: Request) {
  const source = (await getDb().select().from(jobSources).where(eq(jobSources.id, "gmail-radarvagas")).limit(1))[0];
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!source?.enabled || !provided) return null;
  let config: { hash?: string; userId?: string };
  try { config = JSON.parse(source.externalRef) as { hash?: string; userId?: string }; } catch { return null; }
  return config.hash && config.userId && await digest(provided) === config.hash ? { userId: config.userId } : null;
}

/**
 * Ponte segura para o Apps Script: prepara somente itens já enfileirados,
 * relê o perfil canônico e não tem nenhuma operação de envio. O Gmail cria
 * ou reutiliza o rascunho e chama `confirm` para fechar a outbox.
 */
export async function POST(request: Request) {
  const owner = await authenticate(request);
  if (!owner) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: "prepare" | "confirm" | "fail"; outboxId?: string; gmailDraftId?: string; error?: string; limit?: number; retryFailed?: boolean };
  const db = getDb();

  if (body.action === "confirm" || body.action === "fail") {
    if (!body.outboxId) return NextResponse.json({ error: "Identificador da fila obrigatório" }, { status: 400 });
    const item = (await db.select().from(draftOutbox).where(and(eq(draftOutbox.id, body.outboxId), eq(draftOutbox.userId, owner.userId))).limit(1))[0];
    if (!item) return NextResponse.json({ error: "Item da fila não encontrado" }, { status: 404 });
    if (item.status === "drafted") return NextResponse.json({ ok: true, changed: false, status: "drafted" });
    if (body.action === "confirm") {
      if (!body.gmailDraftId) return NextResponse.json({ error: "Identificador do rascunho Gmail obrigatório" }, { status: 400 });
      await db.update(draftOutbox).set({ status: "drafted", gmailDraftId: body.gmailDraftId, error: null, updatedAt: new Date() }).where(eq(draftOutbox.id, item.id));
      return NextResponse.json({ ok: true, changed: true, status: "drafted" });
    }
    await db.update(draftOutbox).set({ status: "failed", error: (body.error ?? "Falha ao criar rascunho").slice(0, 1000), updatedAt: new Date() }).where(eq(draftOutbox.id, item.id));
    return NextResponse.json({ ok: true, changed: true, status: "failed" });
  }

  const profile = (await db.select().from(profiles).where(eq(profiles.userId, owner.userId)).limit(1))[0];
  if (!profile) return NextResponse.json({ drafts: [], reason: "Perfil não encontrado" });
  const canonicalProfile = canonicalizeProfile(profile);
  if (!profileIsReadyForTriage(canonicalProfile)) return NextResponse.json({ drafts: [], reason: "Perfil técnico não está pronto" });
  const versions = getAnalysisVersions(canonicalProfile);
  const limit = Math.max(1, Math.min(20, Math.floor(body.limit ?? 10)));
  const eligibleOutboxStatus = body.retryFailed
    ? or(eq(draftOutbox.status, "pending"), eq(draftOutbox.status, "failed"))
    : eq(draftOutbox.status, "pending");
  const rows = await db.select({
    outboxId: draftOutbox.id,
    jobId: jobs.id,
    title: jobs.title,
    company: jobs.company,
    externalId: jobs.externalId,
    contactEmail: jobs.contactEmail,
    contactSubject: jobs.contactSubject,
    matchingSkills: userJobAnalyses.matchingSkills,
    missingSkills: userJobAnalyses.missingSkills,
    profileRevision: triageHistory.profileRevision,
    rulesRevision: triageHistory.rulesRevision,
    instructionsRevision: triageHistory.instructionsRevision,
  }).from(draftOutbox)
    .innerJoin(jobs, eq(draftOutbox.jobId, jobs.id))
    .innerJoin(triageHistory, eq(draftOutbox.historyId, triageHistory.id))
    .innerJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, draftOutbox.userId), eq(userJobAnalyses.jobId, draftOutbox.jobId)))
    .where(and(eq(draftOutbox.userId, owner.userId), eligibleOutboxStatus))
    .limit(limit);

  const drafts = rows.flatMap((row) => {
    if (!hasValidContactEmail(row.contactEmail)) return [];
    const current = row.profileRevision === versions.profileRevision && row.rulesRevision === versions.rulesRevision && row.instructionsRevision === versions.instructionsRevision;
    if (!current) return [];
    const subject = row.contactSubject?.trim() || `Candidatura — ${row.title}${row.externalId ? ` (vaga ${row.externalId})` : ""}`;
    return [{
      outboxId: row.outboxId,
      to: row.contactEmail!.trim().toLowerCase(),
      subject,
      body: buildApinfoApplicationEmail({ title: row.title, company: row.company, externalId: row.externalId ?? undefined, matchingSkills: list(row.matchingSkills), missingSkills: list(row.missingSkills), seniority: canonicalProfile.seniority, careerRules: canonicalProfile.careerRules }),
    }];
  });
  return NextResponse.json({ drafts, sent: false });
}
