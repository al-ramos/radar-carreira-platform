"use client";
import { useEffect, useState } from "react";
type Item = { jobId: string; veredito: string; motivo: string | null; processedAt: string; title: string; company: string; workMode: string | null; location: string | null; url: string };
type Data = { counts: Record<string, number>; total: number; items: Item[] };
type PilotResult = { batchId: string; processed: Array<{ jobId: string; verdict: string; label: string; blocker: string | null }>; skipped: number };
const rowClass: Record<string, string> = { "✅": "approved", "🟡": "partial", "❌": "rejected", "🔴": "rejected" };
export default function TriageReport({ close }: { close: () => void }) {
  const [data, setData] = useState<Data | null>(null),
    [includeBacklog, setIncludeBacklog] = useState(false),
    [message, setMessage] = useState("Carregando avaliações…"),
    [runningPilot, setRunningPilot] = useState(false),
    [pilot, setPilot] = useState<PilotResult | null>(null);
  useEffect(() => {
    fetch(`/api/admin/triage${includeBacklog ? "?includeBacklog=1" : ""}`)
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (ok) {
          setData(data);
          setMessage(data.items.length ? "" : "Nenhuma vaga avaliada ainda.");
        } else setMessage("Acesso exclusivo para o proprietário.");
      });
  }, [includeBacklog]);
  const date = (v: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(v));
  const rejected = (data?.counts["❌"] ?? 0) + (data?.counts["🔴"] ?? 0);
  const runPilot = async () => {
    setRunningPilot(true);
    setMessage("Executando piloto determinístico de até 10 vagas…");
    try {
      const response = await fetch("/api/triage/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger: "portal", batchSize: 10, aiMode: "off", createDrafts: false }),
      });
      const result = await response.json() as PilotResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir o piloto.");
      setPilot(result);
      setMessage(`Piloto concluído: ${result.processed.length} vagas registradas, ${result.skipped} já processada(s). IA e rascunhos permaneceram desativados.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir o piloto.");
    } finally {
      setRunningPilot(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <section className="modal triage-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close}>
          ×
        </button>
        <p className="eyebrow">TRIAGEM AUTOMÁTICA</p>
        <div className="triage-title">
          <div>
            <h2>Vagas avaliadas por IA</h2>
            <p>Veredito diário segundo os critérios de aderência .NET/C#.</p>
            <button className="secondary" disabled={runningPilot} onClick={runPilot}>
              {runningPilot ? "Executando piloto…" : "Executar piloto de 10 vagas"}
            </button>
          </div>
          <label className="triage-toggle">
            <input
              type="checkbox"
              checked={includeBacklog}
              onChange={(e) => setIncludeBacklog(e.target.checked)}
            />
            Incluir não avaliadas (⚪)
          </label>
        </div>
        {message && <div className="notice">{message}</div>}
        {pilot && (
          <div className="triage-list">
            {pilot.processed.map((item) => (
              <article key={item.jobId} className={`triage-row ${item.verdict === "BATE" ? "approved" : item.verdict === "PROVAVEL" ? "partial" : "rejected"}`}>
                <div>
                  <small>Código {item.jobId}</small>
                  <b>{item.label}</b>
                  {item.blocker && <span>{item.blocker}</span>}
                </div>
                <strong>{item.verdict === "BATE" ? "✅" : item.verdict === "PROVAVEL" ? "🟡" : "❌"}</strong>
              </article>
            ))}
          </div>
        )}
        {data && (
          <>
            <div className="triage-summary">
              <article className="approved">
                <small>Aprovadas ✅</small>
                <strong>{data.counts["✅"] ?? 0}</strong>
              </article>
              <article className="partial">
                <small>Parciais 🟡</small>
                <strong>{data.counts["🟡"] ?? 0}</strong>
              </article>
              <article className="rejected">
                <small>Reprovadas ❌/🔴</small>
                <strong>{rejected}</strong>
              </article>
              <article>
                <small>Total na base</small>
                <strong>{data.total}</strong>
              </article>
            </div>
            <div className="triage-list">
              {data.items.map((item) => (
                <article key={item.jobId} className={`triage-row ${rowClass[item.veredito] ?? "backlog"}`}>
                  <div>
                    <small>
                      {item.company} · {item.workMode ?? "Modalidade não informada"} ·{" "}
                      {item.location ?? "Local não informado"} · {date(item.processedAt)}
                    </small>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <b>{item.title}</b>
                    </a>
                    {item.motivo && <span>{item.motivo}</span>}
                  </div>
                  <strong>{item.veredito}</strong>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
