"use client";
import { useEffect, useState } from "react";
type Item = { jobId: string; veredito: string; motivo: string | null; processedAt: string; title: string; company: string; workMode: string | null; location: string | null; url: string };
type Data = { counts: Record<string, number>; total: number; items: Item[] };
type PilotResult = { batchId: string; processed: Array<{ jobId: string; verdict: string; label: string; blocker: string | null }>; skipped: number };
type HistoryItem = { id: string; batchId: string; verdict: string; label: string; blocker: string | null; source: string; confidence: number; processedAt: string; title: string; company: string; contactEmail: string | null; hasValidContactEmail: boolean; trigger: string };
const rowClass: Record<string, string> = { "✅": "approved", "🟡": "partial", "❌": "rejected", "🔴": "rejected" };
export default function TriageReport({ close }: { close: () => void }) {
  const [data, setData] = useState<Data | null>(null),
    [includeBacklog, setIncludeBacklog] = useState(false),
    [message, setMessage] = useState("Carregando avaliações…"),
    [runningPilot, setRunningPilot] = useState(false),
    [queueingDrafts, setQueueingDrafts] = useState(false),
    [pilot, setPilot] = useState<PilotResult | null>(null),
    [batchSize, setBatchSize] = useState(10),
    [reprocess, setReprocess] = useState(false),
    [history, setHistory] = useState<HistoryItem[]>([]);
  const loadHistory = () => fetch("/api/triage/history")
    .then(async (r) => ({ ok: r.ok, data: await r.json() as { items?: HistoryItem[] } }))
    .then(({ ok, data }) => { if (ok) setHistory(data.items ?? []); });
  useEffect(() => {
    fetch(`/api/admin/triage${includeBacklog ? "?includeBacklog=1" : ""}`)
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (ok) {
          setData(data);
          setMessage(data.items.length ? "" : "Nenhuma vaga avaliada ainda.");
        } else setMessage("Acesso exclusivo para o proprietário.");
      });
    void loadHistory();
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
        body: JSON.stringify({ trigger: "portal", batchSize, reprocess, aiMode: "off", createDrafts: false }),
      });
      const result = await response.json() as PilotResult & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível concluir o piloto.");
      setPilot(result);
      setMessage(`Piloto concluído: ${result.processed.length} vagas registradas, ${result.skipped} já processada(s). IA e rascunhos permaneceram desativados.`);
      void loadHistory();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir o piloto.");
    } finally {
      setRunningPilot(false);
    }
  };
  const queueDrafts = async () => {
    setQueueingDrafts(true);
    setMessage("Verificando vagas elegíveis para a fila de rascunhos…");
    try {
      const response = await fetch("/api/triage/drafts/queue", { method: "POST" });
      const result = await response.json() as { error?: string; queued: number; noValidContact: number; outdated: number; alreadyPresent: number };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível preparar a fila de rascunhos.");
      setMessage(`Fila preparada: ${result.queued} vaga(s) elegível(is); ${result.noValidContact} sem e-mail válido; ${result.outdated} precisa(m) de nova avaliação; ${result.alreadyPresent} já estava(m) na fila. Nenhum e-mail foi criado ou enviado.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível preparar a fila de rascunhos.");
    } finally {
      setQueueingDrafts(false);
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
            <div className="triage-run-panel">
              <div className="triage-run-settings">
                <label>
                  Quantidade
                  <input aria-label="Quantidade de vagas" type="number" min="1" max="100" value={batchSize} onChange={(e) => setBatchSize(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} disabled={runningPilot} />
                </label>
                <label className="triage-reprocess">
                  <input type="checkbox" checked={reprocess} onChange={(e) => setReprocess(e.target.checked)} disabled={runningPilot} />
                  Reavaliar vagas já processadas
                </label>
              </div>
              <button className="primary triage-run-button" disabled={runningPilot} onClick={runPilot}>
                {runningPilot ? "Executando triagem…" : `Iniciar triagem de até ${batchSize} vagas`}
              </button>
              <button className="triage-queue-button" disabled={queueingDrafts || runningPilot} onClick={queueDrafts}>
                {queueingDrafts ? "Preparando fila…" : "Preparar fila de rascunhos elegíveis"}
              </button>
              <small>A fila exige vaga aprovada ou provável, análise atual e e-mail de contato válido. Esta ação não cria nem envia e-mails.</small>
            </div>
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
          <div className="triage-list triage-current-run">
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
        {history.length > 0 && (
          <section className="triage-history" aria-label="Histórico persistido da nova triagem">
            <div>
              <h3>Histórico da nova triagem</h3>
              <small>Resultados gravados no sistema. Rascunhos só poderão ser habilitados futuramente quando houver e-mail de contato válido.</small>
            </div>
            <div className="triage-list">
              {history.slice(0, 20).map((item) => (
                <article key={item.id} className={`triage-row ${rowClass[item.verdict] ?? "backlog"}`}>
                  <div>
                    <small>{item.company} · {date(item.processedAt)} · {item.source === "ai" ? "IA" : "Regras"}</small>
                    <b>{item.title}</b>
                    <span>{item.label}{item.blocker ? ` · ${item.blocker}` : ""}{item.hasValidContactEmail ? " · E-mail de contato válido" : " · Sem e-mail de contato válido"}</span>
                  </div>
                  <strong>{item.verdict}</strong>
                </article>
              ))}
            </div>
          </section>
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
