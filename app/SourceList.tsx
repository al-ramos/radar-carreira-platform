"use client";
import { useEffect, useMemo, useState } from "react";
import { CURATED_SOURCES, QUARANTINED_SOURCES } from "../lib/curated-sources";

type ValidationStatus = "ok" | "empty" | "mismatch" | "error";
type Source = { id: string; name: string; provider: string; collectionMode: "pull" | "push"; enabled: boolean; lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null; consecutiveFailures: number; canCollect: boolean; catalogId?: string; validationStatus: ValidationStatus | null; foundName?: string };
type Props = { onStart: (catalogId: string, name: string) => Promise<void>; onActivateAll: () => Promise<void>; refreshKey?: number };

const PROVIDER_LABELS: Record<string, string> = { greenhouse: "Greenhouse", ashby: "Ashby", lever: "Lever" };
const PROVIDER_ICONS: Record<string, string> = { greenhouse: "🌱", ashby: "🔷", lever: "⚡" };
const providerIcon = (p: string) => PROVIDER_ICONS[p] ?? "🔗";
const providerLabel = (p: string) => PROVIDER_LABELS[p] ?? p;

export default function SourceList({ onStart, onActivateAll, refreshKey = 0 }: Props) {
  const [sources, setSources] = useState<Source[]>([]);
  const [status, setStatus] = useState("Carregando catálogo…");
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState("");
  const [activating, setActivating] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const configured = new Map(sources.filter(s => s.catalogId).map(s => [s.catalogId, s]));
  const hasMismatch = [...configured.values()].some(s => s.validationStatus === "mismatch");

  // Groups sorted by size descending
  const groups = useMemo(() => {
    const map = new Map<string, typeof CURATED_SOURCES>();
    for (const src of CURATED_SOURCES) {
      if (!map.has(src.provider)) map.set(src.provider, []);
      map.get(src.provider)!.push(src);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, []);

  // Per-provider filtered list (respects search)
  const visibleByProvider = useMemo(() => {
    return new Map(groups.map(([provider, list]) => [
      provider,
      normalized ? list.filter(s => s.name.toLocaleLowerCase("pt-BR").includes(normalized)) : list,
    ]));
  }, [groups, normalized]);

  function toggleCollapse(provider: string) {
    setCollapsed(prev => ({ ...prev, [provider]: !prev[provider] }));
  }

  // When searching, force-expand groups that have results
  function isOpen(provider: string) {
    if (normalized && (visibleByProvider.get(provider)?.length ?? 0) > 0) return true;
    return !(collapsed[provider] ?? false);
  }

  const noResults = normalized && [...visibleByProvider.values()].every(list => list.length === 0);

  return (
    <section className="source-manager">
      {status && <div className="notice">{status}</div>}

      <section className="source-group source-catalog">
        <h3>Empresas prontas para coletar <span>{CURATED_SOURCES.length} verificadas</span></h3>
        <p>Ative o catálogo completo em um clique ou inicie uma empresa específica.</p>
        <button className="activate-catalog" disabled={activating || hasMismatch} title={hasMismatch ? "Resolva os conflitos de nome antes de ativar o catálogo" : undefined} onClick={() => void activateAll()}>
          {activating ? "Ativando catálogo…" : "Ativar catálogo completo"}
        </button>
        <input className="source-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar empresa no catálogo" aria-label="Buscar empresa no catálogo" />

        {noResults && <div className="source-empty">Nenhuma empresa encontrada no catálogo.</div>}

        {groups.map(([provider, allSources]) => {
          const visible = visibleByProvider.get(provider) ?? [];
          if (normalized && visible.length === 0) return null;
          const open = isOpen(provider);
          const activeCount = allSources.filter(s => configured.get(s.id)?.enabled).length;
          return (
            <div key={provider} className="provider-group">
              <button className="provider-header" onClick={() => toggleCollapse(provider)} aria-expanded={open}>
                <span className="provider-icon">{providerIcon(provider)}</span>
                <span className="provider-name">{providerLabel(provider)}</span>
                <span className="provider-count">({allSources.length} empresas{activeCount > 0 ? `, ${activeCount} ativas` : ""})</span>
                <span className="provider-chevron">{open ? "▴" : "▾"}</span>
              </button>
              {open && visible.map(source => {
                const registered = configured.get(source.id);
                const isMismatch = registered?.validationStatus === "mismatch";
                return (
                  <article key={source.id}>
                    <i className={isMismatch ? "mismatch" : registered?.lastError ? "warn" : registered?.enabled ? "on" : "off"} />
                    <span>
                      <b>{source.name}</b>
                      <small>
                        {registered?.lastSuccessAt ? `última coleta: ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(registered.lastSuccessAt))}` : "Pronta para a primeira coleta"}
                        {isMismatch && <><br />⚠ Retornou: {registered!.foundName}</>}
                        {!isMismatch && registered?.lastError && <><br />Última falha: {registered.lastError}</>}
                      </small>
                    </span>
                    <button className="source-start" disabled={starting === source.id} onClick={() => void start(source.id, source.name)}>
                      {starting === source.id ? "Iniciando…" : "Iniciar coleta"}
                    </button>
                  </article>
                );
              })}
            </div>
          );
        })}
      </section>

      <section className="source-group source-configured">
        <h3>Empresas cadastradas <span>{sources.filter(s => s.collectionMode === "pull").length}</span></h3>
        <p>Pause uma fonte quando não quiser incluí-la nas coletas em lote.</p>
        {sources.filter(s => s.collectionMode === "pull").map(source => (
          <article key={source.id}>
            <i className={source.enabled ? "on" : "off"} />
            <span><b>{source.name}</b><small>{source.provider} · {source.enabled ? "ativa" : "pausada"}</small></span>
            <button onClick={() => void toggle(source)}>{source.enabled ? "Pausar" : "Reativar"}</button>
          </article>
        ))}
        {!sources.filter(s => s.collectionMode === "pull").length && <div className="source-empty">Nenhuma fonte ativada ainda.</div>}
      </section>

      <section className="source-group source-quarantine">
        <h3>Fontes em quarentena <span>{QUARANTINED_SOURCES.length}</span></h3>
        <p>Retiradas do catálogo por retornar vagas vazias ou de empresa incorreta. Não reativar sem localizar o board correto.</p>
        {QUARANTINED_SOURCES.map(source => (
          <article key={source.id}>
            <i className="off" />
            <span>
              <b>{source.name}</b>
              <small>
                {providerLabel(source.provider)} · <code>{source.externalRef}</code>
                {source.ambiguousSlug && <> · <mark className="badge-ambiguous">slug ambíguo</mark></>}
                <br />{source.reason}
              </small>
            </span>
          </article>
        ))}
      </section>

      <section className="source-group">
        <h3>Integrações de entrada <span>{sources.filter(s => s.collectionMode === "push").length}</span></h3>
        <p>Recebem vagas enviadas por outros serviços e não participam da coleta automática.</p>
        {sources.filter(s => s.collectionMode === "push").map(source => (
          <article key={source.id}>
            <i className={source.enabled ? "on" : "off"} />
            <span><b>{source.name}</b><small>{source.provider} · integração de envio</small></span>
            <button onClick={() => void toggle(source)}>{source.enabled ? "Pausar" : "Reativar"}</button>
          </article>
        ))}
        {!sources.filter(s => s.collectionMode === "push").length && <div className="source-empty">Nenhuma integração configurada.</div>}
      </section>
    </section>
  );
}
