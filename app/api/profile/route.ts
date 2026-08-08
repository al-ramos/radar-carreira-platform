import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../db/index";
import { profiles } from "../../../db/schema";
import { allowedWorkModes, listFromStored, normalizeMinScore } from "../../../lib/profile-options";
import { getChatGPTUser } from "../../chatgpt-auth";

const ADMINS = new Set(["contato@amrsolution.com.br", "alexsandro.ramos@gmail.com", "prof.andreiamr@gmail.com"]);
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const db = getDb();
  const admin = ADMINS.has(user.email.toLowerCase());
  let profile = (await db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
  if (!profile) {
    profile = { userId: user.userId, email: user.email, name: user.fullName, role: admin ? "admin" : "user", seniority: null, preferredMode: null, cities: "[]", masteredSkills: "[]", desiredAreas: "[]", avoidTerms: "[]", minScore: 60, updatedAt: new Date() };
    await db.insert(profiles).values(profile);
  } else if (admin && profile.role !== "admin") {
    await db.update(profiles).set({ role: "admin", updatedAt: new Date() }).where(eq(profiles.userId, user.userId));
    profile = { ...profile, role: "admin", updatedAt: new Date() };
  }
  return NextResponse.json({ user: { ...user, role: profile.role }, profile: { ...profile, seniority: listFromStored(profile.seniority), preferredMode: allowedWorkModes(profile.preferredMode), masteredSkills: listFromStored(profile.masteredSkills), desiredAreas: listFromStored(profile.desiredAreas), avoidTerms: listFromStored(profile.avoidTerms) } });
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Autenticação necessária" }, { status: 401 });
  const db = getDb();
  const existing = (await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
  const body = await request.json() as Record<string, unknown>;
  const storedList = (key: string) => JSON.stringify(listFromStored(body[key]));
  const score = normalizeMinScore(body.minScore);
  const values = {
    userId: user.userId, email: user.email, name: user.fullName,
    role: ADMINS.has(user.email.toLowerCase()) ? "admin" as const : existing?.role??"user" as const,
    seniority: storedList("seniority"), preferredMode: JSON.stringify(allowedWorkModes(body.preferredMode)), cities: "[]",
    masteredSkills: storedList("masteredSkills"), desiredAreas: storedList("desiredAreas"), avoidTerms: storedList("avoidTerms"),
    minScore: score, updatedAt: new Date(),
  };
  await db.insert(profiles).values(values).onConflictDoUpdate({ target: profiles.userId, set: values });
  return NextResponse.json({ ok: true, profile: { minScore: score } });
}
