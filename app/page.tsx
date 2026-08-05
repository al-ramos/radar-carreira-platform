import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Dashboard from "./Dashboard";
import { getChatGPTUser } from "./chatgpt-auth";
import { getDb } from "../db/index";
import { profiles } from "../db/schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Radar Carreira Platform",
  description: "Vagas certas. Decisões melhores.",
};

export default async function Home() {
  const user = await getChatGPTUser();
  if (user) {
    let needsOnboarding = false;
    try {
      const profile = (await getDb().select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1))[0];
      needsOnboarding = !profile?.seniority;
    } catch {
      // banco indisponível — segue para o dashboard em vez de travar a home
    }
    if (needsOnboarding) redirect("/onboarding");
  }
  return <Dashboard />;
}
