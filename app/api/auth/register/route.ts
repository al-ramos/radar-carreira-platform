import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  createLocalUserSession,
  hashLocalPassword,
  LOCAL_PASSWORD_MIN_LENGTH,
  LOCAL_SESSION_COOKIE,
  localSessionCookieOptions,
} from "../../../chatgpt-auth";
import { getDb } from "../../../../db";
import { localAccounts, profiles } from "../../../../db/schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { name?: unknown; email?: unknown; password?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < LOCAL_PASSWORD_MIN_LENGTH) {
    return NextResponse.json({ error: `Informe seu nome, um e-mail válido e uma senha com ao menos ${LOCAL_PASSWORD_MIN_LENGTH} caracteres.` }, { status: 400 });
  }

  const db = getDb();
  const existing = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.email, email)).limit(1);
  if (existing[0]) return NextResponse.json({ error: "Já existe uma conta para este e-mail. Entre com sua senha." }, { status: 409 });

  const credentials = await hashLocalPassword(password);
  const now = new Date();
  const account = { userId: `local-${crypto.randomUUID()}`, email, name, ...credentials };
  await db.insert(localAccounts).values({ ...account, createdBy: null, createdAt: now, updatedAt: now });
  await db.insert(profiles).values({
    userId: account.userId, email, name, role: "user", seniority: null, preferredMode: null,
    cities: "[]", masteredSkills: "[]", desiredAreas: "[]", avoidTerms: "[]", minScore: 60, updatedAt: now,
  });

  const session = await createLocalUserSession(account, password);
  if (!session) return NextResponse.json({ error: "Conta criada, mas não foi possível iniciar a sessão. Tente entrar novamente." }, { status: 500 });
  const response = NextResponse.json({ ok: true }, { status: 201 });
  response.cookies.set(LOCAL_SESSION_COOKIE, session, localSessionCookieOptions());
  return response;
}
