import { NextResponse } from "next/server";
import {
  createLocalAdminSession,
  LOCAL_SESSION_COOKIE,
  localSessionCookieOptions,
} from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  if (typeof body?.password !== "string" || !body.password) {
    return NextResponse.json({ error: "Informe a senha de administrador." }, { status: 400 });
  }

  const session = await createLocalAdminSession(body.password);
  if (!session) {
    return NextResponse.json({ error: "Senha inválida ou autenticação ainda não configurada." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCAL_SESSION_COOKIE, session, localSessionCookieOptions());
  return response;
}
