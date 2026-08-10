import { eq } from "drizzle-orm";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { can } from "../../../../../lib/rbac";
import { getDb } from "../../../../../db/index";
import { jobSources } from "../../../../../db/schema";

export const dynamic = "force-dynamic";

/** Mesma allowlist da rota de import — nome de exibição de cada fonte push. */
const KNOWN_SOURCES: Record<string, string> = {
  "linkedin-extension": "Extensão LinkedIn",
  "apinfo-extension": "Extensão APinfo",
};

async function admin() {
  const user = await getChatGPTUser();
  if (!user) return null;
  return (await can(user, "collector_key.manage")) ? user : null;
}
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function GET(_request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  if (!(await admin())) return Response.json({ error: "Acesso de administrador necessário" }, { status: 403 });
  const { sourceId } = await params;
  if (!KNOWN_SOURCES[sourceId]) return Response.json({ error: "Fonte de coleta desconhecida" }, { status: 404 });
  const source = (await getDb().select({ id: jobSources.id }).from(jobSources).where(eq(jobSources.id, sourceId)).limit(1))[0];
  return Response.json({ configured: Boolean(source) });
}

export async function POST(request: Request, { params }: { params: Promise<{ sourceId: string }> }) {
  const user = await admin();
  if (!user) return Response.json({ error: "Acesso de administrador necessário" }, { status: 403 });
  const { sourceId } = await params;
  const sourceName = KNOWN_SOURCES[sourceId];
  if (!sourceName) return Response.json({ error: "Fonte de coleta desconhecida" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { key?: string } | null;
  const key = body?.key?.trim() ?? "";
  if (key.length < 32) return Response.json({ error: "Gere uma chave segura antes de salvá-la" }, { status: 400 });
  const now = new Date();
  const values = {
    id: sourceId,
    name: sourceName,
    provider: "manual" as const,
    collectionMode: "push" as const,
    externalRef: JSON.stringify({ hash: await digest(key), userId: user.userId, createdAt: now.toISOString() }),
    enabled: true,
    lastRunAt: null,
    createdAt: now,
  };
  await getDb()
    .insert(jobSources)
    .values(values)
    .onConflictDoUpdate({ target: jobSources.id, set: { externalRef: values.externalRef, collectionMode: "push", enabled: true } });
  return Response.json({ ok: true });
}
