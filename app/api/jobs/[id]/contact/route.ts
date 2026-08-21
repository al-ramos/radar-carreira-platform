import { and, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobs } from "../../../../../db/schema";
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
  const body = (await request.json().catch(() => null)) as { contactEmail?: string; contactSubject?: string; correctTruncated?: boolean } | null;
  const contactEmail = normalizeContactEmail(body?.contactEmail);
  if (!contactEmail) return NextResponse.json({ error: "Informe um único e-mail de contato válido" }, { status: 400 });

  const db = getDb();
  const job = (await db.select({ id: jobs.id, contactEmail: jobs.contactEmail }).from(jobs).where(eq(jobs.id, id)).limit(1))[0];
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });
  const existingEmail = normalizeContactEmail(job.contactEmail);
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

  return NextResponse.json({ ok: true, contactEmail: updated[0].contactEmail, contactSubject: updated[0].contactSubject });
}
