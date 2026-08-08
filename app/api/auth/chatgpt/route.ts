import { NextResponse } from "next/server";
import { getHostedChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

function returnPath(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!await getHostedChatGPTUser()) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("auth_error", "chatgpt");
    return NextResponse.redirect(login);
  }
  return NextResponse.redirect(new URL(returnPath(url.searchParams.get("return_to")), url.origin));
}
