import { NextResponse } from "next/server";
import { LOCAL_SESSION_COOKIE, localSessionCookieOptions } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCAL_SESSION_COOKIE, "", { ...localSessionCookieOptions(), maxAge: 0 });
  return response;
}
