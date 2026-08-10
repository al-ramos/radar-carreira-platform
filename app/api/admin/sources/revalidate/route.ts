import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { jobSources } from "../../../../../db/schema";
import { validate } from "../../../../../lib/connectors";
import { CURATED_SOURCES } from "../../../../../lib/curated-sources";
import { can } from "../../../../../lib/access";

export const dynamic = "force-dynamic";

async function isAuthorized(request: Request): Promise<boolean> {
  // 1. Bearer token — usado pelo cron do GitHub Actions
  const secret = process.env.REVALIDATION_SECRET;
  const auth = request.headers.get("Authorization");
  if (secret && auth === `Bearer ${secret}`) return true;

  // 2. Sessão do proprietário (ou de quem tenha sources.manage) — usada pelo botão na UI
  const u = await getChatGPTUser();
  if (!u) return false;
  return can(u, "sources.manage");
}

export async function POST(request: Request) {
  if (!await isAuthorized(request)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const db = getDb();
  const now = new Date();
  let validated = 0, ok = 0, empty = 0, mismatch = 0, error = 0;

  for (const item of CURATED_SOURCES) {
    const result = await validate(item.provider, item.externalRef, item.name);
    validated++;

    if (result.status === "ok") ok++;
    else if (result.status === "empty") empty++;
    else if (result.status === "mismatch") mismatch++;
    else error++;

    await db.update(jobSources)
      .set({
        validationStatus: result.status,
        foundName: result.foundName ?? null,
        lastValidated: now,
      })
      .where(and(
        eq(jobSources.provider, item.provider),
        eq(jobSources.externalRef, item.externalRef),
      ));
  }

  return NextResponse.json({ validated, ok, empty, mismatch, error });
}
