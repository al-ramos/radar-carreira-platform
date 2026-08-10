import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { permissions } from "../../../../db/schema";
import { can } from "../../../../lib/rbac";

export const dynamic = "force-dynamic";

/**
 * Catálogo fixo de permissões (seed em drizzle/0011_rbac_seed.sql). Só
 * leitura — o catálogo de "quais permissões existem" não é editável pela
 * UI, apenas quais roles as possuem.
 */
export async function GET() {
  const user = await getChatGPTUser();
  if (!user || !await can(user, "roles.manage")) {
    return NextResponse.json({ error: "Acesso restrito ao gerenciamento de perfis." }, { status: 403 });
  }
  const db = getDb();
  const rows = await db.select().from(permissions).orderBy(asc(permissions.module), asc(permissions.id));
  return NextResponse.json({ permissions: rows });
}
