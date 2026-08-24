import { and, desc, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { companyContacts, jobEvents, jobs } from "../../../../../db/schema";
import { companyContactKey } from "../../../../../lib/company-contact";
import { normalizeContactEmail } from "../../../../../lib/contact-email";

export const dynamic = "force-dynamic";

/**
 * Salva o contato (e-mail/assunto) de uma vaga já existente, capturado no
 * próprio painel do Radar (botão "Capturar e-mail", que por baixo dos panos
 * pede à extensão do APinfo para ler o que já está na tela de contato,
 * aberta manualmente pela pessoa). Exige a mesma sessão autenticada do
 * Radar — não é a chave da extensão (Bearer token), é o cookie de quem
 * está logado no site.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { contactEmail?: string; contactSubject?: string; correctTruncated?: boolean; useCompanyContact?: boolean } | null;
  const db = getDb();
  const job = (await db.select({ id: jobs.id, company: jobs.company, contactEmail: jobs.contactEmail }).from(jobs).where(eq(jobs.id, id)).limit(1))[0];
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  const existingEmail = normalizeContactEmail(job.contactEmail);
  const companyKey = companyContactKey(job.company);
  if (body?.useCompanyContact) {
    if (existingEmail) return NextResponse.json({ ok: true, contactEmail: existingEmail, reused: true, updated: false });
    let companyContact = companyKey
      ? (await db.select().from(companyContacts).where(eq(companyContacts.companyKey, companyKey)).limit(1))[0]
      : undefined;
    // Aproveita também os contatos que já existiam nas vagas antes da
    // criação do catálogo. Assim a primeira consulta já migra o histórico
    // útil, sem exigir uma rotina de carga nem nova captura no APInfo.
    if (!companyContact) {
      const historical = await db.select({ contactEmail: jobs.contactEmail, contactSubject: jobs.contactSubject })
        .from(jobs).where(eq(jobs.company, job.company)).orderBy(desc(jobs.updatedAt));
      const found = historical.find((item) => normalizeContactEmail(item.contactEmail));
      const email = normalizeContactEmail(found?.contactEmail);
      if (email && companyKey) {
        const now = new Date();
        await db.insert(companyContacts).values({ companyKey, companyName: job.company, contactEmail: email, contactSubject: found?.contactSubject ?? null, createdAt: now, updatedAt: now }).onConflictDoNothing();
        companyContact = { companyKey, companyName: job.company, contactEmail: email, contactSubject: found?.contactSubject ?? null, createdAt: now, updatedAt: now };
      }
    }
    if (!companyContact) return NextResponse.json({ error: "Nenhum e-mail cadastrado para esta empresa" }, { status: 404 });
    const updated = await db.update(jobs)
      .set({ contactEmail: companyContact.contactEmail, contactSubject: companyContact.contactSubject, updatedAt: new Date() })
      .where(and(eq(jobs.id, id), or(isNull(jobs.contactEmail), eq(jobs.contactEmail, ""))))
      .returning({ id: jobs.id, contactEmail: jobs.contactEmail, contactSubject: jobs.contactSubject });
    if (updated[0]) {
      await db.insert(jobEvents).values({
        jobId: updated[0].id,
        type: "company_contact_reused",
        detail: JSON.stringify({ email: updated[0].contactEmail, company: job.company, actorUserId: user.userId }),
        occurredAt: new Date(),
      });
    }
    return NextResponse.json({ ok: true, contactEmail: updated[0]?.contactEmail ?? companyContact.contactEmail, contactSubject: updated[0]?.contactSubject ?? companyContact.contactSubject, reused: true, updated: Boolean(updated[0]) });
  }
  const contactEmail = normalizeContactEmail(body?.contactEmail);
  if (!contactEmail) return NextResponse.json({ error: "Informe um único e-mail de contato válido" }, { status: 400 });
  // Correção estritamente conservadora: permite completar apenas um domínio
  // previamente salvo sem o sufixo final (ex.: "empresa.com" ->
  // "empresa.com.br"). Não permite trocar destinatário já cadastrado.
  const canCorrectTruncated = Boolean(
    body?.correctTruncated && existingEmail && contactEmail.startsWith(`${existingEmail}.`),
  );
  if (existingEmail && !canCorrectTruncated) {
    return NextResponse.json(
      { error: "Esta vaga já possui e-mail de contato cadastrado", contactEmail: job.contactEmail },
      { status: 409 },
    );
  }

  const contactIsMissing = or(isNull(jobs.contactEmail), eq(jobs.contactEmail, ""));
  const updated = await db
    .update(jobs)
    .set({ contactEmail, contactSubject: body?.contactSubject?.trim() || null, updatedAt: new Date() })
    .where(canCorrectTruncated ? and(eq(jobs.id, id), eq(jobs.contactEmail, existingEmail!)) : and(eq(jobs.id, id), contactIsMissing))
    .returning({ id: jobs.id, contactEmail: jobs.contactEmail, contactSubject: jobs.contactSubject });

  if (!updated.length) {
    return NextResponse.json({ error: "Esta vaga já possui e-mail de contato cadastrado" }, { status: 409 });
  }

  if (companyKey) {
    const now = new Date();
    await db.insert(companyContacts).values({ companyKey, companyName: job.company, contactEmail, contactSubject: body?.contactSubject?.trim() || null, createdAt: now, updatedAt: now }).onConflictDoNothing();
  }

  await db.insert(jobEvents).values({
    jobId: updated[0].id,
    type: "contact_captured",
    detail: JSON.stringify({ email: updated[0].contactEmail, actorUserId: user.userId }),
    occurredAt: new Date(),
  });

  return NextResponse.json({ ok: true, contactEmail: updated[0].contactEmail, contactSubject: updated[0].contactSubject, companyContactSaved: Boolean(companyKey) });
}
