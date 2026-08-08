import { NextResponse } from "next/server";
import { createLocalUserSession, LOCAL_SESSION_COOKIE, localSessionCookieOptions } from "../../../chatgpt-auth";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { localAccounts } from "../../../../db/schema";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  if (typeof body?.password !== "string" || !body.password) {
    return NextResponse.json({ error: "Informe sua senha." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const account = email
    ? (await getDb().select().from(localAccounts).where(eq(localAccounts.email, email)).limit(1))[0]
    : null;
  const session = account ? await createLocalUserSession(account, body.password) : null;
  if (!session) {
    return NextResponse.json({ error: email ? "E-mail ou senha inválidos." : "Senha inválida ou autenticação ainda não configurada." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCAL_SESSION_COOKIE, session, localSessionCookieOptions());
  return response;
}
