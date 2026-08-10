import type { Metadata } from "next";
import Dashboard from "./Dashboard";
import { requireChatGPTUser } from "./chatgpt-auth";

export const metadata: Metadata = {
  title: "Radar Carreira | Seu próximo movimento",
  description: "Encontre as oportunidades certas e avance com clareza.",
};

export default async function Home() {
  await requireChatGPTUser("/");
  return <Dashboard />;
}
