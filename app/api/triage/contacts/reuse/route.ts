import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { companyContacts, jobs } from "../../../../../db/schema";
import { companyContactKey } from "../../../../../lib/company-contact";
import { normalizeContactEmail } from "../../../../../lib/contact-email";

export const dynamic = "force-dynamic";

/**
 * Reaproveita somente contatos já conhecidos pelo Radar. Não procura e-mails
 * externamente e nunca substitui o contato que já existe na vaga.
 */
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { jobIds?: unknown };
  const jobIds = Array.isArray(body.jobIds)
    ? [...new Set(body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 100)
    : [];
  if (!jobIds.length) return NextResponse.json({ error: "Selecione ao menos uma vaga" }, { status: 400 });

  const db = getDb();
  const selected = await db.select({ id: jobs.id, company: jobs.company, contactEmail: jobs.contactEmail, contactSubject: jobs.contactSubject })
    .from(jobs).where(inArray(jobs.id, jobIds));
  const missing = selected.filter((job) => !normalizeContactEmail(job.contactEmail));
  const keys = [...new Set(missing.map((job) => companyContactKey(job.company)).filter((key): key is string => Boolean(key)))];
  const catalog = keys.length
    ? await db.select().from(companyContacts).where(inArray(companyContacts.companyKey, keys))
    : [];
  const contactByCompany = new Map(catalog.map((contact) => [contact.companyKey, contact]));
  let reused = 0, alreadyWithContact = selected.length - missing.length, unavailable = 0;
  const updated: Array<{ jobId: string; contactEmail: string }> = [];

  for (const job of missing) {
    const key = companyContactKey(job.company);
    if (!key) { unavailable += 1; continue; }
    let contact = contactByCompany.get(key);
    // Migra, quando necessário, o contato de outra vaga da mesma empresa
    // para o catálogo reutilizável. Não há busca fora da base do Radar.
    if (!contact) {
      const historical = await db.select({ contactEmail: jobs.contactEmail, contactSubject: jobs.contactSubject })
        .from(jobs).where(eq(jobs.company, job.company)).orderBy(desc(jobs.updatedAt));
      const found = historical.find((item) => normalizeContactEmail(item.contactEmail));
      const email = normalizeContactEmail(found?.contactEmail);
      if (email) {
        const now = new Date();
        await db.insert(companyContacts).values({ companyKey: key, companyName: job.company, contactEmail: email, contactSubject: found?.contactSubject ?? null, createdAt: now, updatedAt: now }).onConflictDoNothing();
        contact = { companyKey: key, companyName: job.company, contactEmail: email, contactSubject: found?.contactSubject ?? null, createdAt: now, updatedAt: now };
        contactByCompany.set(key, contact);
      }
    }
    if (!contact) { unavailable += 1; continue; }
    const result = await db.update(jobs)
      .set({ contactEmail: contact.contactEmail, contactSubject: contact.contactSubject, updatedAt: new Date() })
      .where(and(eq(jobs.id, job.id), or(isNull(jobs.contactEmail), eq(jobs.contactEmail, ""))))
      .returning({ id: jobs.id, contactEmail: jobs.contactEmail });
    if (result[0]) { reused += 1; updated.push({ jobId: result[0].id, contactEmail: result[0].contactEmail ?? contact.contactEmail }); }
  }

  return NextResponse.json({ ok: true, considered: selected.length, reused, alreadyWithContact, unavailable, updated });
}
