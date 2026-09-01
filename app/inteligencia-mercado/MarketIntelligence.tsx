"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import "./market-intelligence.css";

type Period = "7" | "30" | "90" | "all";
type Metric = { label: string; count: number; share: number };
type SourceOption = Metric & { id: string };
type MarketData = {
  generatedAt: string;
  filters: { period: Period; source: string; area: string };
  limited: boolean;
  sampleLimit: number | null;
  summary: { total: number; active: number; companies: number; newLastSevenDays: number; descriptions: number; locationsPresent: number; stacksPresent: number };
  sourceOptions: SourceOption[];
  trend: Array<{ bucket: string; label: string; count: number }>;
  breakdowns: { skills: Metric[]; locations: Metric[]; areas: Metric[]; workModes: Metric[]; sources: Metric[]; companies: Metric[] };
  insights: string[];
  dataAvailability: { salary: boolean; contract: boolean; sector: boolean };
};

const areas = [
  ["all", "Todas as áreas"], ["backend", "Back-end"], ["frontend", "Front-end"], ["fullstack", "Full Stack"],
  ["devops", "DevOps / SRE / Cloud"], ["data", "Dados / BI / IA"], ["mobile", "Mobile"], ["qa", "QA / Testes"],
  ["security", "Segurança"], ["infrastructure", "Infraestrutura / Suporte"], ["product", "Produto / UX"], ["management", "Gestão de Tecnologia"], ["other", "Outras áreas"],
] as const;

const number = new Intl.NumberFormat("pt-BR");

function Ranking({ title, items, empty }: { title: string; items: Metric[]; empty: string }) {
  const max = Math.max(1, ...items.map(item => item.count));
  return <section className="market-card market-ranking"><div className="market-section-heading"><h2>{title}</h2><span>{items.length ? `${items.length} itens` : ""}</span></div>{items.length ? <ol>{items.map(item => <li key={item.label}><span className="market-ranking-label" title={item.label}>{item.label}</span><i aria-hidden="true"><b style={{ width: `${item.count * 100 / max}%` }} /></i><strong>{number.format(item.count)}</strong></li>)}</ol> : <p className="market-empty">{empty}</p>}</section>;
}

function Trend({ items }: { items: MarketData["trend"] }) {
  const max = Math.max(1, ...items.map(item => item.count));
  return <section className="market-card market-trend"><div className="market-section-heading"><div><h2>Volume de vagas recebidas</h2><p>Evolução do recorte selecionado.</p></div></div>{items.length ? <div className="market-trend-bars" role="img" aria-label="Gráfico de barras com o volume de vagas recebidas por período">{items.map(item => <div key={item.bucket} title={`${item.label}: ${item.count} vagas`}><span style={{ height: `${Math.max(6, item.count * 100 / max)}%` }} /><small>{item.label}</small></div>)}</div> : <p className="market-empty">Ainda não há datas suficientes para formar uma tendência.</p>}</section>;
}

export default function MarketIntelligence() {
  const [period, setPeriod] = useState<Period>("30");
  const [source, setSource] = useState("all");
  const [area, setArea] = useState("all");
  const [data, setData] = useState<MarketData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ period, source, area });
    fetch(`/api/market-intelligence?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => ({ ok: response.ok, data: await response.json() as MarketData & { error?: string } }))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error ?? "Não foi possível calcular os indicadores.");
        setData(data);
        setError("");
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setError(error instanceof Error ? error.message : "Não foi possível calcular os indicadores.");
      });
    return () => controller.abort();
  }, [period, source, area]);

  const quality = useMemo(() => data ? [
    { label: "Com descrição", value: data.summary.total ? Math.round(data.summary.descriptions * 100 / data.summary.total) : 0 },
    { label: "Com localização", value: data.summary.total ? Math.round(data.summary.locationsPresent * 100 / data.summary.total) : 0 },
    { label: "Com tecnologias", value: data.summary.total ? Math.round(data.summary.stacksPresent * 100 / data.summary.total) : 0 },
  ] : [], [data]);
  const loading = !data || data.filters.period !== period || data.filters.source !== source || data.filters.area !== area;

  return <main className="market-page">
    <header className="market-header">
      <Link className="market-brand" href="/" aria-label="Voltar ao Radar Carreira"><span>⌁</span> RADAR <b>CARREIRA</b></Link>
      <Link className="market-back" href="/">← Voltar ao Radar</Link>
    </header>
    <section className="market-hero">
      <div><p className="eyebrow">INTELIGÊNCIA DE MERCADO</p><h1>Decisões de carreira guiadas por evidências.</h1><p>Consolide o volume, as tecnologias, as empresas e a distribuição das oportunidades já recebidas pelo Radar.</p></div>
      {data && <div className="market-update">Atualizado agora<br /><small>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(data.generatedAt))}</small></div>}
    </section>
    <section className="market-filters" aria-label="Filtros da inteligência de mercado">
      <label>Período<select value={period} onChange={event => setPeriod(event.target.value as Period)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="all">Todo o histórico</option></select></label>
      <label>Fonte<select value={source} onChange={event => setSource(event.target.value)}><option value="all">Todas as fontes</option>{data?.sourceOptions.map(option => <option key={option.id} value={option.id}>{option.label} ({number.format(option.count)})</option>)}</select></label>
      <label>Área profissional<select value={area} onChange={event => setArea(event.target.value)}>{areas.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    </section>
    {loading && <p className="market-notice" role="status">Atualizando indicadores…</p>}
    {error && <p className="market-notice" role="alert">{error}</p>}
    {data && <>
      {data.limited && <p className="market-notice" role="status">A leitura usa as {number.format(data.sampleLimit ?? 0)} vagas mais recentes do recorte para preservar o tempo de resposta. Refine os filtros para uma análise exata.</p>}
      <section className="market-kpis" aria-label="Resumo do mercado">
        <article><small>Vagas no recorte</small><strong>{number.format(data.summary.total)}</strong><span>{number.format(data.summary.newLastSevenDays)} recebidas nos últimos 7 dias</span></article>
        <article><small>Vagas ativas</small><strong>{number.format(data.summary.active)}</strong><span>disponíveis no momento da leitura</span></article>
        <article><small>Empresas</small><strong>{number.format(data.summary.companies)}</strong><span>com oportunidades registradas</span></article>
        <article className="market-kpi-highlight"><small>Tecnologias líderes</small><strong>{data.breakdowns.skills[0]?.label ?? "—"}</strong><span>{data.breakdowns.skills[0] ? `${data.breakdowns.skills[0].share}% do recorte` : "aguardando dados estruturados"}</span></article>
      </section>
      <section className="market-grid market-grid-primary"><Trend items={data.trend} /><Ranking title="Tecnologias mais pedidas" items={data.breakdowns.skills} empty="Nenhuma tecnologia foi identificada neste recorte." /></section>
      <section className="market-grid"><Ranking title="Áreas com mais oportunidades" items={data.breakdowns.areas} empty="Nenhuma área foi classificada neste recorte." /><Ranking title="Distribuição geográfica" items={data.breakdowns.locations} empty="Nenhuma localização foi informada neste recorte." /><Ranking title="Empresas mais presentes" items={data.breakdowns.companies} empty="Nenhuma empresa foi identificada neste recorte." /></section>
      <section className="market-grid market-grid-secondary"><Ranking title="Modalidade de trabalho" items={data.breakdowns.workModes} empty="A modalidade ainda não foi informada." /><Ranking title="Origem das oportunidades" items={data.breakdowns.sources} empty="Nenhuma origem foi identificada." /><section className="market-card market-insights"><div className="market-section-heading"><h2>Leituras do Radar</h2><span>Fatos, não previsões</span></div><ul>{data.insights.map(insight => <li key={insight}>{insight}</li>)}</ul></section></section>
      <section className="market-grid market-grid-secondary"><section className="market-card market-quality"><div className="market-section-heading"><div><h2>Qualidade para análise</h2><p>Quanto mais completos os registros, mais confiáveis serão as leituras.</p></div></div>{quality.map(item => <div key={item.label}><span>{item.label}</span><i><b style={{ width: `${item.value}%` }} /></i><strong>{item.value}%</strong></div>)}</section><section className="market-card market-next"><p className="eyebrow">PRÓXIMOS DADOS</p><h2>Salário, contrato e setor</h2><p>Esses indicadores só serão liberados quando a coleta passar a armazená-los como campos estruturados. Assim, o Radar evita inferências frágeis a partir de texto livre.</p><ul><li>Benchmark salarial</li><li>Tipos de contratação</li><li>Saturação por setor</li></ul></section></section>
    </>}
  </main>;
}
