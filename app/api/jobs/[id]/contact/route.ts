import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobs } from "../../../../../db/schema";

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
  const body = (await request.json().catch(() => null)) as { contactEmail?: string; contactSubject?: string } | null;
  const contactEmail = body?.contactEmail?.trim();
  if (!contactEmail) return NextResponse.json({ error: "E-mail de contato ausente" }, { status: 400 });

  const db = getDb();
  const job = (await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id)).limit(1))[0];
  if (!job) return NextResponse.json({ error: "Vaga não encontrada" }, { status: 404 });

  await db
    .update(jobs)
    .set({ contactEmail, contactSubject: body?.contactSubject?.trim() || null, updatedAt: new Date() })
    .where(eq(jobs.id, id));

  return NextResponse.json({ ok: true, contactEmail, contactSubject: body?.contactSubject?.trim() || null });
}
