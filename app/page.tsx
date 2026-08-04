import type { Metadata } from "next";
import Dashboard from "./Dashboard";

export const metadata: Metadata = {
  title: "Radar Carreira Platform",
  description: "Vagas certas. Decisões melhores.",
};

export default function Home() {
  return <Dashboard />;
}
