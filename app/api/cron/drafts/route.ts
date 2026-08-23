import { and, eq, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db/index";
import { draftOutbox, jobSources, jobs, profiles, triageHistory, userJobAnalyses } from "../../../../db/schema";
import { getAnalysisVersions } from "../../../../lib/analysis-versions";
import { buildApinfoApplicationEmail } from "../../../../lib/application-email";
import { canonicalizeProfile, profileIsReadyForTriage } from "../../../../lib/canonical-profile";
import { normalizeContactEmail } from "../../../../lib/contact-email";
import { evaluateDeterministicTriage } from "../../../../lib/deterministic-triage";
import { isDraftAllowedForSource, isSafeForDraft } from "../../../../lib/draft-eligibility";
import { notifyDraftSent } from "../../../../lib/notifications";

export const dynamic = "force-dynamic";

const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const list = (value: string) => { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } };
const parseStack = (value: string) => { try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } };
const CONNECTOR_VERSION = "radar-drafts-v2";
const subjectFor = (item: { draftSubject: string | null; contactSubject: string | null; title: string; externalId: string | null }) =>
  item.draftSubject?.trim() || item.contactSubject?.trim() || `Candidatura — ${item.title}${item.externalId ? ` (vaga ${item.externalId})` : ""}`;
const parseSentAt = (value: unknown) => {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

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
  const body = await request.json().catch(() => ({})) as {
    action?: "prepare" | "confirm" | "fail" | "health" | "sentCandidates" | "reconcileSent";
    outboxId?: string; gmailDraftId?: string; gmailSentId?: string; subject?: string; to?: string; sentAt?: string;
    error?: string; limit?: number; retryFailed?: boolean; connectorVersion?: string; outboxIds?: string[];
  };
  const db = getDb();

  if (body.connectorVersion && body.connectorVersion !== CONNECTOR_VERSION) {
    return NextResponse.json({ error: "Conector Gmail desatualizado. Atualize o arquivo gmail-radarvagas.gs antes de criar rascunhos." }, { status: 409 });
  }

  if (body.action === "health") return NextResponse.json({ ok: true, connectorVersion: CONNECTOR_VERSION, sent: false });

  // Esta consulta não pesquisa o Gmail nem cria mensagens. Ela só devolve os
  // rascunhos confirmados que podem ser comparados localmente pelo Apps Script
  // com a pasta "Enviados".
  if (body.action === "sentCandidates") {
    const limit = Math.max(1, Math.min(100, Math.floor(body.limit ?? 100)));
    const requestedOutboxIds = Array.isArray(body.outboxIds) ? [...new Set(body.outboxIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 20) : null;
    if (Array.isArray(body.outboxIds) && !requestedOutboxIds?.length) return NextResponse.json({ error: "Nenhum rascunho válido foi informado." }, { status: 400 });
    const candidates = await db.select({
      outboxId: draftOutbox.id,
      to: jobs.contactEmail,
      title: jobs.title,
      externalId: jobs.externalId,
      contactSubject: jobs.contactSubject,
      draftSubject: draftOutbox.draftSubject,
      draftedAt: draftOutbox.updatedAt,
    }).from(draftOutbox)
      .innerJoin(jobs, eq(draftOutbox.jobId, jobs.id))
      .where(and(eq(draftOutbox.userId, owner.userId), eq(draftOutbox.status, "drafted"), requestedOutboxIds ? inArray(draftOutbox.id, requestedOutboxIds) : undefined))
      .limit(limit);
    return NextResponse.json({
      candidates: candidates.flatMap((item) => {
        const to = normalizeContactEmail(item.to);
        return to ? [{ outboxId: item.outboxId, to, subject: subjectFor(item), draftedAt: item.draftedAt.toISOString() }] : [];
      }),
      sent: false,
    });
  }

  // O Apps Script só chega aqui depois de encontrar, em "Enviados", uma
  // correspondência exata por destinatário e assunto. Mesmo assim, o Radar
  // valida novamente os dados persistidos e não aceita promover outro estado.
  if (body.action === "reconcileSent") {
    if (!body.outboxId || !body.gmailSentId) return NextResponse.json({ error: "Identificadores da fila e da mensagem enviada são obrigatórios" }, { status: 400 });
    const item = (await db.select({
      id: draftOutbox.id,
      status: draftOutbox.status,
      gmailSentId: draftOutbox.gmailSentId,
      draftSubject: draftOutbox.draftSubject,
      contactEmail: jobs.contactEmail,
      contactSubject: jobs.contactSubject,
      title: jobs.title,
      company: jobs.company,
      externalId: jobs.externalId,
    }).from(draftOutbox).innerJoin(jobs, eq(draftOutbox.jobId, jobs.id))
      .where(and(eq(draftOutbox.id, body.outboxId), eq(draftOutbox.userId, owner.userId))).limit(1))[0];
    if (!item) return NextResponse.json({ error: "Item da fila não encontrado" }, { status: 404 });
    if (item.status === "sent") {
      if (item.gmailSentId === body.gmailSentId) return NextResponse.json({ ok: true, changed: false, status: "sent" });
      return NextResponse.json({ error: "A vaga já está vinculada a outra mensagem enviada" }, { status: 409 });
    }
    if (item.status !== "drafted") return NextResponse.json({ error: "Somente rascunhos confirmados podem ser marcados como enviados" }, { status: 409 });
    const expectedTo = normalizeContactEmail(item.contactEmail);
    const expectedSubject = subjectFor(item);
    const sentAt = parseSentAt(body.sentAt);
    if (!expectedTo || normalizeContactEmail(body.to) !== expectedTo || body.subject?.trim() !== expectedSubject || !sentAt) {
      return NextResponse.json({ error: "A mensagem enviada não corresponde ao destinatário, assunto e data esperados" }, { status: 409 });
    }
    await db.update(draftOutbox).set({ status: "sent", gmailSentId: body.gmailSentId.slice(0, 500), sentAt, error: null, updatedAt: new Date() }).where(eq(draftOutbox.id, item.id));
    // Falha ao notificar não deve reverter nem repetir a reconciliação já
    // gravada — o estado "sent" já é a fonte de verdade; a notificação é só
    // um aviso complementar no sino do portal.
    await notifyDraftSent(db, { outboxId: item.id, title: item.title, company: item.company, externalId: item.externalId, to: expectedTo, sentAt }).catch((error) => {
      console.error(`Falha ao notificar envio confirmado de ${item.id}:`, error);
    });
    return NextResponse.json({ ok: true, changed: true, status: "sent", sentAt });
  }

  if (body.action === "confirm" || body.action === "fail") {
    if (!body.outboxId) return NextResponse.json({ error: "Identificador da fila obrigatório" }, { status: 400 });
    const item = (await db.select().from(draftOutbox).where(and(eq(draftOutbox.id, body.outboxId), eq(draftOutbox.userId, owner.userId))).limit(1))[0];
    if (!item) return NextResponse.json({ error: "Item da fila não encontrado" }, { status: 404 });
    if (item.status === "drafted" || item.status === "sent") return NextResponse.json({ ok: true, changed: false, status: item.status });
    if (body.action === "confirm") {
      if (!body.gmailDraftId) return NextResponse.json({ error: "Identificador do rascunho Gmail obrigatório" }, { status: 400 });
      await db.update(draftOutbox).set({ status: "drafted", gmailDraftId: body.gmailDraftId, draftSubject: body.subject?.trim().slice(0, 500) || null, error: null, updatedAt: new Date() }).where(eq(draftOutbox.id, item.id));
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
  const requestedOutboxIds = Array.isArray(body.outboxIds) ? [...new Set(body.outboxIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 20) : null;
  if (Array.isArray(body.outboxIds) && !requestedOutboxIds?.length) return NextResponse.json({ drafts: [], reason: "Nenhum item de rascunho válido foi informado." }, { status: 400 });
  const eligibleOutboxStatus = body.retryFailed
    ? or(eq(draftOutbox.status, "pending"), eq(draftOutbox.status, "failed"))
    : eq(draftOutbox.status, "pending");
  const rows = await db.select({
    outboxId: draftOutbox.id,
    jobId: jobs.id,
    sourceId: jobs.sourceId,
    title: jobs.title,
    company: jobs.company,
    externalId: jobs.externalId,
    contactEmail: jobs.contactEmail,
    contactSubject: jobs.contactSubject,
    draftSubject: draftOutbox.draftSubject,
    description: jobs.description,
    stack: jobs.stack,
    seniority: jobs.seniority,
    workMode: jobs.workMode,
    location: jobs.location,
    publishedAt: jobs.publishedAt,
    matchingSkills: userJobAnalyses.matchingSkills,
    missingSkills: userJobAnalyses.missingSkills,
    analysisVerdict: userJobAnalyses.verdict,
    analysisBlocker: userJobAnalyses.blocker,
    analysisProfileRevision: userJobAnalyses.profileRevision,
    analysisRulesRevision: userJobAnalyses.rulesRevision,
    analysisInstructionsRevision: userJobAnalyses.instructionsRevision,
    profileRevision: triageHistory.profileRevision,
    rulesRevision: triageHistory.rulesRevision,
    instructionsRevision: triageHistory.instructionsRevision,
  }).from(draftOutbox)
    .innerJoin(jobs, eq(draftOutbox.jobId, jobs.id))
    .innerJoin(triageHistory, eq(draftOutbox.historyId, triageHistory.id))
    .innerJoin(userJobAnalyses, and(eq(userJobAnalyses.userId, draftOutbox.userId), eq(userJobAnalyses.jobId, draftOutbox.jobId)))
    .where(and(eq(draftOutbox.userId, owner.userId), eligibleOutboxStatus, requestedOutboxIds ? inArray(draftOutbox.id, requestedOutboxIds) : undefined))
    .limit(limit);

  const drafts: Array<{ outboxId: string; to: string; subject: string; body: string }> = [];
  for (const row of rows) {
    const versionsCurrent = row.profileRevision === versions.profileRevision
      && row.rulesRevision === versions.rulesRevision
      && row.instructionsRevision === versions.instructionsRevision
      && row.analysisProfileRevision === versions.profileRevision
      && row.analysisRulesRevision === versions.rulesRevision
      && row.analysisInstructionsRevision === versions.instructionsRevision;
    const deterministic = evaluateDeterministicTriage({
      title: row.title,
      description: row.description,
      stack: parseStack(row.stack),
      seniority: row.seniority,
      workMode: row.workMode,
      location: row.location,
      publishedAt: row.publishedAt,
    }, canonicalProfile);
    const safe = isDraftAllowedForSource({ sourceId: row.sourceId, verdict: row.analysisVerdict, contactEmail: row.contactEmail }) && versionsCurrent && isSafeForDraft({
      verdict: row.analysisVerdict,
      blocker: row.analysisBlocker,
      contactEmail: row.contactEmail,
      sourceId: row.sourceId,
      deterministicVerdict: deterministic.verdict,
      deterministicBlocker: deterministic.blocker,
    });
    if (!safe) {
      const reason = !isDraftAllowedForSource({ sourceId: row.sourceId, verdict: row.analysisVerdict, contactEmail: row.contactEmail })
        ? "A fonte LinkedIn só permite rascunho quando aprovada (✅) e com e-mail de contato válido."
        : !versionsCurrent
        ? "Análise desatualizada; reavalie a vaga antes de criar rascunho."
        : !row.contactEmail?.trim()
          ? "E-mail de contato inválido ou ausente."
          : "Revalidação atual não aprovou a vaga para rascunho.";
      await db.update(draftOutbox).set({ status: "cancelled", error: reason, updatedAt: new Date() }).where(eq(draftOutbox.id, row.outboxId));
      continue;
    }
    const subject = subjectFor(row);
    drafts.push({
      outboxId: row.outboxId,
      to: row.contactEmail!.trim().toLowerCase(),
      subject,
      body: buildApinfoApplicationEmail({ title: row.title, company: row.company, externalId: row.externalId ?? undefined, matchingSkills: list(row.matchingSkills), missingSkills: list(row.missingSkills), seniority: canonicalProfile.seniority, careerRules: canonicalProfile.careerRules }),
    });
  }
  return NextResponse.json({ drafts, scanned: rows.length, hasMore: rows.length === limit, connectorVersion: CONNECTOR_VERSION, sent: false });
}
