import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_ID_HEADER = "oai-authenticated-user-id";
const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/login";
const SIGN_OUT_PATH = "/api/auth/logout";
const CALLBACK_PATH = "/callback";

export const LOCAL_SESSION_COOKIE = "radar_admin_session";
const LOCAL_ADMIN_ID = "radar-local-admin";
const LOCAL_ADMIN_EMAIL = "alexsandro.ramos@gmail.com";
const LOCAL_ADMIN_NAME = "Alex Ramos";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

type RuntimeEnv = {
  RADAR_ADMIN_PASSWORD?: string;
  RADAR_SESSION_SECRET?: string;
};

type SessionPayload = {
  sub: string;
  exp: number;
};

function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

function sessionSecret(): string | null {
  return runtimeEnv().RADAR_SESSION_SECRET?.trim() || null;
}

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (value.length % 4)) % 4)}`;
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function localAdmin(): ChatGPTUser {
  return {
    userId: LOCAL_ADMIN_ID,
    displayName: LOCAL_ADMIN_NAME,
    email: LOCAL_ADMIN_EMAIL,
    fullName: LOCAL_ADMIN_NAME,
  };
}

async function readLocalSession(): Promise<ChatGPTUser | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const session = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
  if (!session) return null;
  const [encodedPayload, encodedSignature, ...rest] = session.split(".");
  if (!encodedPayload || !encodedSignature || rest.length) return null;

  const signature = decodeBase64Url(encodedSignature);
  if (!signature || !sameBytes(signature, await sign(encodedPayload, secret))) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload) ?? new Uint8Array())) as SessionPayload;
    if (payload.sub !== LOCAL_ADMIN_ID || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return localAdmin();
  } catch {
    return null;
  }
}

export async function createLocalAdminSession(password: string): Promise<string | null> {
  const configuredPassword = runtimeEnv().RADAR_ADMIN_PASSWORD?.trim();
  const secret = sessionSecret();
  if (!configuredPassword || !secret || !sameBytes(new TextEncoder().encode(password), new TextEncoder().encode(configuredPassword))) {
    return null;
  }

  const payload = encodeBase64Url(JSON.stringify({ sub: LOCAL_ADMIN_ID, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 } satisfies SessionPayload));
  return `${payload}.${encodeBase64Url(await sign(payload, secret))}`;
}

export function localSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: true,
  };
}

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);

  if (userId && email) {
    const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
    const fullName =
      encodedFullName &&
      requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
        ? safeDecodeURIComponent(encodedFullName)
        : null;
    return { userId, displayName: fullName ?? email, email, fullName };
  }

  const sessionUser = await readLocalSession();
  if (sessionUser) return sessionUser;

  const host = requestHeaders.get("host") || "";
  if (host.includes("localhost") || host.includes("127.0.0.1")) {
    return {
      userId: "local-dev-user-123",
      displayName: "Almir (Dev)",
      email: "almir.dev@example.com",
      fullName: "Almir (Dev)",
    };
  }
  return null;
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local" || isReservedAuthPath(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return pathname === SIGN_IN_PATH || pathname === SIGN_OUT_PATH || pathname === CALLBACK_PATH;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
