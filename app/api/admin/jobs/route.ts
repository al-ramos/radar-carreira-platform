import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { alertReads, jobEvents, jobs, profiles, userJobStatus } from "../../../../db/schema";

const ADMIN_EMAILS = new Set([
  "contato@amrsolution.com.br",
  "alexsandro.ramos@gmail.com",
  "prof.andreiamr@gmail.com",
]);

async function isAdmin() {
  const user = await getChatGPTUser();
  if (!user) return false;
  if (ADMIN_EMAILS.has(user.email.toLowerCase())) return true;
  const profile = (await getDb()
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, user.userId))
    .limit(1))[0];
  return profile?.role === "admin";
}

/** Removes all vacancies and their job-linked state, while preserving users and settings. */
export async function DELETE() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Acesso de administrador necessário" }, { status: 403 });
  }

  const db = getDb();
  const existing = await db.select({ id: jobs.id }).from(jobs);
  if (!existing.length) return NextResponse.json({ ok: true, deleted: 0 });

  await db.delete(alertReads);
  await db.delete(userJobStatus);
  await db.delete(jobEvents);
  await db.delete(jobs);

  return NextResponse.json({ ok: true, deleted: existing.length });
}
