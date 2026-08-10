import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { profiles } from "../../../../../db/schema";
import { can } from "../../../../../lib/rbac";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "alexsandro.ramos@gmail.com";

async function admin() {
  const user = await getChatGPTUser();
  if (!user) return null;
  return await can(user, "users.change_role") ? user : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await admin()) return NextResponse.json({ error: "Acesso de administrador necessário" }, { status: 403 });
  const { userId } = await params;
  const body = await request.json() as { role?: unknown };
  const role = body.role;
  if (role !== "admin" && role !== "user") {
    return NextResponse.json({ error: "Informe role como \"admin\" ou \"user\"." }, { status: 400 });
  }
  const db = getDb();
  const target = (await db.select({ email: profiles.email }).from(profiles).where(eq(profiles.userId, userId)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });
  if (target.email.toLowerCase() === OWNER_EMAIL) {
    return NextResponse.json({ error: "A conta principal não pode ter o papel alterado." }, { status: 409 });
  }
  await db.update(profiles).set({ role, updatedAt: new Date() }).where(eq(profiles.userId, userId));
  return NextResponse.json({ ok: true, userId, role });
}
