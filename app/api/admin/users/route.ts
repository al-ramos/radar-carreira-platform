import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser, hashLocalPassword, LOCAL_PASSWORD_MIN_LENGTH } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { localAccounts, profiles, userJobStatus } from "../../../../db/schema";
import { listFromStored } from "../../../../lib/profile-options";

export const dynamic = "force-dynamic";

const PROTECTED = new Set(["contato@amrsolution.com.br", "alexsandro.ramos@gmail.com", "prof.andreiamr@gmail.com"]);

async function admin() {
  const user = await getChatGPTUser();
  if (!user) return null;
  if (PROTECTED.has(user.email.toLowerCase())) return user;
  const profile = (await getDb().select({ role: profiles.role }).from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
  return profile?.role === "admin" ? user : null;
}

function userSummary(profile: typeof profiles.$inferSelect, pipeline: typeof userJobStatus.$inferSelect[], access: "convite" | "chatgpt" | "administrador") {
  const seniority = listFromStored(profile.seniority);
  const preferredMode = listFromStored(profile.preferredMode);
  const skills = listFromStored(profile.masteredSkills);
  const areas = listFromStored(profile.desiredAreas);
  return {
    userId: profile.userId,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    seniority: seniority.join(" · ") || null,
    preferredMode: preferredMode.join(" · ") || null,
    skills: skills.length,
    areas: areas.length,
    pipeline: pipeline.filter(item => item.userId === profile.userId).length,
    profileComplete: Boolean(seniority.length && preferredMode.length && skills.length && areas.length),
    protected: PROTECTED.has(profile.email.toLowerCase()),
    access,
    updatedAt: profile.updatedAt,
  };
}

export async function GET() {
  if (!await admin()) return NextResponse.json({ error: "Acesso de administrador necessário" }, { status: 403 });
  const db = getDb();
  const [accountRows, profileRows, pipeline] = await Promise.all([
    db.select().from(localAccounts).orderBy(desc(localAccounts.createdAt)),
    db.select().from(profiles).orderBy(desc(profiles.updatedAt)),
    db.select().from(userJobStatus),
  ]);
  const profilesById = new Map(profileRows.map(profile => [profile.userId, profile]));
  const accountIds = new Set(accountRows.map(account => account.userId));
  const invited = accountRows.flatMap(account => {
    const profile = profilesById.get(account.userId);
    return profile ? [userSummary(profile, pipeline, "convite")] : [];
  });
  const automatic = profileRows
    .filter(profile => !accountIds.has(profile.userId))
    .map(profile => userSummary(profile, pipeline, PROTECTED.has(profile.email.toLowerCase()) ? "administrador" : "chatgpt"));
  return NextResponse.json({ users: [...invited, ...automatic] });
}

export async function POST(request: Request) {
  const actor = await admin();
  if (!actor) return NextResponse.json({ error: "Acesso de administrador necessário" }, { status: 403 });
  const body = await request.json() as { name?: unknown; email?: unknown; password?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < LOCAL_PASSWORD_MIN_LENGTH) {
    return NextResponse.json({ error: `Informe nome, e-mail válido e uma senha com ao menos ${LOCAL_PASSWORD_MIN_LENGTH} caracteres.` }, { status: 400 });
  }
  if (PROTECTED.has(email)) return NextResponse.json({ error: "Este e-mail já é reservado para a administração principal." }, { status: 409 });
  const db = getDb();
  const existing = (await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.email, email)).limit(1))[0];
  if (existing) return NextResponse.json({ error: "Já existe uma conta para este e-mail." }, { status: 409 });
  const passwordData = await hashLocalPassword(password);
  const now = new Date();
  const userId = `local-${crypto.randomUUID()}`;
  await db.insert(localAccounts).values({
    userId,
    email,
    name,
    ...passwordData,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(profiles).values({
    userId,
    email,
    name,
    role: "user",
    seniority: null,
    preferredMode: null,
    cities: "[]",
    masteredSkills: "[]",
    desiredAreas: "[]",
    avoidTerms: "[]",
    minScore: 60,
    updatedAt: now,
  });
  return NextResponse.json({ ok: true, userId }, { status: 201 });
}

export async function PATCH(request: Request) {
  const actor = await admin();
  if (!actor) return NextResponse.json({ error: "Acesso de administrador necessário" }, { status: 403 });
  const body = await request.json() as { userId?: string; role?: string };
  if (!body.userId || !new Set(["admin", "user"]).has(body.role ?? "")) return NextResponse.json({ error: "Usuário e função são obrigatórios" }, { status: 400 });
  const db = getDb();
  const target = (await db.select().from(profiles).where(eq(profiles.userId, body.userId)).limit(1))[0];
  if (!target) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (PROTECTED.has(target.email.toLowerCase()) && body.role !== "admin") return NextResponse.json({ error: "O administrador principal não pode ser rebaixado" }, { status: 409 });
  await db.update(profiles).set({ role: body.role as "admin" | "user", updatedAt: new Date() }).where(eq(profiles.userId, body.userId));
  return NextResponse.json({ ok: true });
}
