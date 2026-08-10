"use client";

import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("./Dashboard"), {
  ssr: false,
  loading: () => (
    <main className="platform">
      <section className="radar-main">
        <p className="eyebrow">RADAR · CARREGANDO</p>
        <h1>Preparando seu radar…</h1>
      </section>
    </main>
  ),
});

export default function DashboardShell() {
  return <Dashboard />;
}
