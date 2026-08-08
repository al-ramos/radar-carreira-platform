"use client";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CURATED_SOURCES, QUARANTINED_SOURCES } from "../lib/curated-sources";

type ValidationStatus = "ok" | "empty" | "mismatch" | "error";
type Source = { id: string; name: string; provider: string; collectionMode: "pull" | "push"; enabled: boolean; lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null; consecutiveFailures: number; canCollect: boolean; catalogId?: string; validationStatus: ValidationStatus | null; foundName?: string; lastValidated: string | null };
type Props = {
  onStart: (catalogId: string, name: string) => Promise<void>;
  onActivateAll: () => Promise<void>;
  onCollectAll: () => Promise<void>;
  refreshKey?: number;
};

type RevalidateResult = { validated: number; ok: number; empty: number; mismatch: number; error: number };
type SourceView = "catalog" | "configured" | "quarantine" | "integrations";

const PROVIDER_LABELS: Record<string, string> = { greenhouse: "Greenhouse", ashby: "Ashby", lever: "Lever" };
const providerLabel = (p: string) => PROVIDER_LABELS[p] ?? p;

export default function SourceList({ onStart, onActivateAll, onCollectAll, refreshKey = 0 }: Props) {
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState("Carregando catálogo…");
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState("");
  const [activating, setActivating] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [revalidateResult, setRevalidateResult] = useState<RevalidateResult | null>(null);
  const [providerFilter, setProviderFilter] = useState("all");
  const [activeView, setActiveView] = useState<SourceView>("configured");
  const [collectingAll, setCollectingAll] = useState(false);

  useEffect(() => {
    fetch("/api/admin/sources").then(async r => ({ ok: r.ok, data: await r.json() })).then(({ ok, data }) => {
      if (ok) { setSources(data.sources); setStatus(""); } else setStatus("Não foi possível carregar o status das fontes.");
    });
  }, [refreshKey]);

  async function toggle(source: Source) {
    const r = await fetch("/api/admin/sources", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: source.id, enabled: !source.enabled }) });
    if (r.ok) { setSources(list => list.map(item => item.id === source.id ? { ...item, enabled: !item.enabled } : item)); setStatus(!source.enabled ? "Fonte reativada." : "Fonte pausada."); }
  }

  async function start(catalogId: string, name: string) { setStarting(catalogId); try { await onStart(catalogId, name); } finally { setStarting(""); } }
  async function activateAll() { setActivating(true); try { await onActivateAll(); } finally { setActivating(false); } }
  async function collectAll() { setCollectingAll(true); try { await onCollectAll(); } finally { setCollectingAll(false); } }

  async function revalidateAll() {
    setRevalidating(true);
    setRevalidateResult(null);
    try {
      const r = await fetch("/api/admin/sources/revalidate", { method: "POST" });
      if (r.ok) {
        const result = await r.json() as RevalidateResult;
        setRevalidateResult(result);
        // Refresh source list to reflect updated validationStatus / lastValidated
        const fresh = await fetch("/api/admin/sources");
        if (fresh.ok) { const d = await fresh.json() as { sources: Source[] }; setSources(d.sources); }
      } else {
        setStatus("Erro ao revalidar fontes.");
      }
    } finally {
      setRevalidating(false);
    }
  }

  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const configured = new Map(sources.filter(s => s.catalogId).map(s => [s.catalogId, s]));
  const hasMismatch = [...configured.values()].some(s => s.validationStatus === "mismatch");

  const providers = useMemo(() => [...new Set(CURATED_SOURCES.map(source => source.provider))], []);
  const catalogRows = useMemo(() => CURATED_SOURCES
    .filter(source => providerFilter === "all" || source.provider === providerFilter)
    .filter(source => !normalized || source.name.toLocaleLowerCase("pt-BR").includes(normalized))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")), [normalized, providerFilter]);
  const pullSources = sources.filter(source => source.collectionMode === "pull");
  const pushSources = sources.filter(source => source.collectionMode === "push");

  return (
    <section className="source-manager">
      {status && <div className="notice">{status}</div>}

      <div className="source-workspace-summary">
        <div>
          <strong>{pullSources.filter(source => source.enabled).length} fontes ativas</strong>
          <span>{pullSources.length} empresas cadastradas para coleta automática</span>
        </div>
        <button className="primary" disabled={collectingAll || !pullSources.length} onClick={() => void collectAll()}>
          {collectingAll ? "Coletando…" : "Coletar fontes ativas"}
        </button>
      </div>

      <nav className="source-tabs" aria-label="Seções de empresas e integrações">
        <button className={activeView === "configured" ? "active" : ""} onClick={() => setActiveView("configured")}>Cadastradas <span>{pullSources.length}</span></button>
        <button className={activeView === "catalog" ? "active" : ""} onClick={() => setActiveView("catalog")}>Explorar catálogo <span>{CURATED_SOURCES.length}</span></button>
        <button className={activeView === "quarantine" ? "active" : ""} onClick={() => setActiveView("quarantine")}>Quarentena <span>{QUARANTINED_SOURCES.length}</span></button>
        <button className={activeView === "integrations" ? "active" : ""} onClick={() => setActiveView("integrations")}>Integrações <span>{pushSources.length}</span></button>
      </nav>

      {activeView === "catalog" && <section className="source-group source-catalog">
        <h3>Empresas prontas para coletar <span>{CURATED_SOURCES.length} verificadas</span></h3>
        <p>Ative o catálogo completo em um clique ou inicie uma empresa específica.</p>
        <div className="source-bulk-actions">
          <button className="activate-catalog" disabled={activating || hasMismatch} title={hasMismatch ? "Resolva os conflitos de nome antes de ativar o catálogo" : undefined} onClick={() => void activateAll()}>
            {activating ? "Ativando catálogo…" : "Ativar catálogo completo"}
          </button>
          <button className="source-secondary-action" disabled={revalidating} onClick={() => void revalidateAll()}>
            {revalidating ? "⏳ Revalidando…" : "Revalidar todas"}
          </button>
        </div>
        {revalidateResult && (
          <div className="notice" style={{ marginTop: "0.5rem" }}>
            ✅ {revalidateResult.ok} ok
            {revalidateResult.empty > 0 && <> · 🟡 {revalidateResult.empty} sem vagas</>}
            {revalidateResult.mismatch > 0 && <> · ⚠️ {revalidateResult.mismatch} mismatch</>}
            {revalidateResult.error > 0 && <> · ❌ {revalidateResult.error} erro</>}
            {" "}({revalidateResult.validated} verificadas)
          </div>
        )}
        <div className="source-table-toolbar">
          <input className="source-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar empresa" aria-label="Buscar empresa no catálogo" />
          <select value={providerFilter} onChange={event => setProviderFilter(event.target.value)} aria-label="Filtrar por plataforma">
            <option value="all">Todas as plataformas</option>
            {providers.map(provider => <option key={provider} value={provider}>{providerLabel(provider)}</option>)}
          </select>
          <span>{catalogRows.length} exibidas</span>
        </div>
        <SourceTable>
          <thead><tr><th>Empresa</th><th>Plataforma</th><th>Status</th><th>Última coleta</th><th><span className="sr-only">Ação</span></th></tr></thead>
          <tbody>{catalogRows.map(source => {
            const registered = configured.get(source.id);
            const mismatch = registered?.validationStatus === "mismatch";
            const statusLabel = mismatch ? "Nome divergente" : registered?.lastError ? "Com falha" : registered?.enabled ? "Ativa" : registered ? "Pausada" : "Pronta";
            const lastRun = registered?.lastSuccessAt
              ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(registered.lastSuccessAt))
              : "Ainda não coletada";
            return <tr key={source.id}>
              <td><strong>{source.name}</strong>{mismatch && <small>Retornou: {registered?.foundName}</small>}</td>
              <td>{providerLabel(source.provider)}</td>
              <td><span className={`source-status ${mismatch ? "attention" : registered?.enabled ? "active" : "ready"}`}>{statusLabel}</span></td>
              <td>{lastRun}</td>
              <td><button className="source-start" disabled={starting === source.id} onClick={() => void start(source.id, source.name)}>{starting === source.id ? "Iniciando…" : "Coletar"}</button></td>
            </tr>;
          })}</tbody>
        </SourceTable>
        {!catalogRows.length && <div className="source-empty">Nenhuma empresa encontrada com esses filtros.</div>}
      </section>}

      {activeView === "configured" && <section className="source-group source-configured">
        <h3>Empresas cadastradas <span>{pullSources.length}</span></h3>
        <p>Pause uma fonte quando não quiser incluí-la nas coletas em lote.</p>
        <SourceTable><thead><tr><th>Empresa</th><th>Plataforma</th><th>Status</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{pullSources.map(source => <tr key={source.id}><td><strong>{source.name}</strong></td><td>{providerLabel(source.provider)}</td><td><span className={`source-status ${source.enabled ? "active" : "paused"}`}>{source.enabled ? "Ativa" : "Pausada"}</span></td><td><button onClick={() => void toggle(source)}>{source.enabled ? "Pausar" : "Reativar"}</button></td></tr>)}</tbody></SourceTable>
        {!pullSources.length && <div className="source-empty">Nenhuma fonte ativada ainda.</div>}
      </section>}

      {activeView === "quarantine" && <section className="source-group source-quarantine">
        <h3>Fontes em quarentena <span>{QUARANTINED_SOURCES.length}</span></h3>
        <p>Retiradas do catálogo por retornar vagas vazias ou de empresa incorreta. Não reativar sem localizar o board correto.</p>
        <SourceTable><thead><tr><th>Empresa</th><th>Plataforma</th><th>Motivo</th></tr></thead><tbody>{QUARANTINED_SOURCES.map(source => <tr key={source.id}><td><strong>{source.name}</strong></td><td>{providerLabel(source.provider)}</td><td>{source.reason}</td></tr>)}</tbody></SourceTable>
      </section>}

      {activeView === "integrations" && <section className="source-group">
        <h3>Integrações de entrada <span>{pushSources.length}</span></h3>
        <p>Recebem vagas enviadas por outros serviços e não participam da coleta automática.</p>
        <SourceTable><thead><tr><th>Integração</th><th>Tipo</th><th>Status</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{pushSources.map(source => <tr key={source.id}><td><strong>{source.name}</strong></td><td>{providerLabel(source.provider)}</td><td><span className={`source-status ${source.enabled ? "active" : "paused"}`}>{source.enabled ? "Ativa" : "Pausada"}</span></td><td><button onClick={() => void toggle(source)}>{source.enabled ? "Pausar" : "Reativar"}</button></td></tr>)}</tbody></SourceTable>
        {!pushSources.length && <div className="source-empty">Nenhuma integração configurada.</div>}
      </section>}
    </section>
  );
}

function SourceTable({ children }: { children: ReactNode }) {
  return <div className="source-table-wrap"><table className="source-table">{children}</table></div>;
}
