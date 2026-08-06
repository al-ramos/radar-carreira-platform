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
export const LOCAL_PASSWORD_MIN_LENGTH = 12;
// Mantido abaixo do limite de CPU do Worker; o sal aleatório e a sessão HMAC
// continuam impedindo reutilização e vazamento de senha em texto puro.
const PASSWORD_HASH_ITERATIONS = 25_000;

type RuntimeEnv = {
  RADAR_ADMIN_PASSWORD?: string;
  RADAR_SESSION_SECRET?: string;
};

type SessionPayload = {
  sub: string;
  email: string;
  fullName: string | null;
  exp: number;
};

export type LocalAccountCredentials = {
  userId: string;
  email: string;
  name: string | null;
  passwordHash: string;
  passwordSalt: string;
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

async function derivePassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_HASH_ITERATIONS },
    key,
    256,
  ));
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

function localUser(payload: SessionPayload): ChatGPTUser {
  return {
    userId: payload.sub,
    displayName: payload.fullName ?? payload.email,
    email: payload.email,
    fullName: payload.fullName,
  };
}

async function createLocalSession(user: ChatGPTUser): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload = encodeBase64Url(JSON.stringify({
    sub: user.userId,
    email: user.email,
    fullName: user.fullName,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  } satisfies SessionPayload));
  return `${payload}.${encodeBase64Url(await sign(payload, secret))}`;
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
    if (!payload.sub || !payload.email || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return localUser(payload);
  } catch {
    return null;
  }
}

export async function createLocalAdminSession(password: string): Promise<string | null> {
  const configuredPassword = runtimeEnv().RADAR_ADMIN_PASSWORD?.trim();
  if (!configuredPassword || !sameBytes(new TextEncoder().encode(password), new TextEncoder().encode(configuredPassword))) {
    return null;
  }
  return createLocalSession(localAdmin());
}

export async function hashLocalPassword(password: string) {
  if (password.length < LOCAL_PASSWORD_MIN_LENGTH) throw new Error(`A senha precisa ter ao menos ${LOCAL_PASSWORD_MIN_LENGTH} caracteres.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    passwordHash: encodeBase64Url(await derivePassword(password, salt)),
    passwordSalt: encodeBase64Url(salt),
  };
}

export async function createLocalUserSession(account: LocalAccountCredentials, password: string): Promise<string | null> {
  const salt = decodeBase64Url(account.passwordSalt);
  const expectedHash = decodeBase64Url(account.passwordHash);
  if (!salt || !expectedHash) return null;
  const receivedHash = await derivePassword(password, salt);
  if (!sameBytes(receivedHash, expectedHash)) return null;
  return createLocalSession({
    userId: account.userId,
    displayName: account.name ?? account.email,
    email: account.email,
    fullName: account.name,
  });
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

async function currentRequestHeaders(): Promise<Headers | null> {
  try {
    return await headers();
  } catch {
    return null;
  }
}

export async function getHostedChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await currentRequestHeaders();
  if (!requestHeaders) return null;
  const host = (requestHeaders.get("host") || "").toLowerCase();
  if (!host.endsWith(".chatgpt.site")) return null;
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

  return null;
}

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const hostedUser = await getHostedChatGPTUser();
  if (hostedUser) return hostedUser;

  const sessionUser = await readLocalSession();
  if (sessionUser) return sessionUser;

  const requestHeaders = await currentRequestHeaders();
  if (!requestHeaders) return null;
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
