export type MarketPeriod = "7" | "30" | "90" | "all";

export type MarketJob = {
  id: string;
  company: string;
  location: string | null;
  workMode: string | null;
  stack: string;
  status: "active" | "possibly_closed" | "closed";
  roleArea: string;
  sourceId: string | null;
  sourceName: string | null;
  publishedAt: Date | string | null;
  sourcePublishedAt: Date | string | null;
  firstSeenAt: Date | string;
  description: string;
};

export type MarketFilters = {
  period: MarketPeriod;
  source: string;
  area: string;
};

export type MarketMetric = { label: string; count: number; share: number };

type BuildOptions = {
  now?: Date;
  limited?: boolean;
  sampleLimit?: number;
};

const parseStack = (value: string) => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).map(item => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const asDate = (value: Date | string | null | undefined) => {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

// A página mede o mercado a partir da entrada no Radar, a mesma referência
// usada nos filtros operacionais. A data de publicação continua preservada
// para a vaga, mas não altera artificialmente o período analisado.
const jobDate = (job: MarketJob) => asDate(job.firstSeenAt) ?? new Date(0);

const areaLabels: Record<string, string> = {
  backend: "Back-end",
  frontend: "Front-end",
  fullstack: "Full Stack",
  devops: "DevOps / SRE / Cloud",
  data: "Dados / BI / IA",
  mobile: "Mobile",
  qa: "QA / Testes",
  security: "Segurança",
  infrastructure: "Infraestrutura / Suporte",
  product: "Produto / UX",
  management: "Gestão de Tecnologia",
  other: "Outras áreas",
};

const areaLabel = (area: string) => areaLabels[area] ?? areaLabels.other;

const metricList = (items: Iterable<string>, total: number, limit = 8): MarketMetric[] => {
  const counts = new Map<string, number>();
  for (const raw of items) {
    const label = raw.trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "pt-BR"))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count, share: total ? Math.round((count / total) * 100) : 0 }));
};

const weekStart = (date: Date) => {
  const normalized = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  normalized.setUTCDate(normalized.getUTCDate() - ((normalized.getUTCDay() + 6) % 7));
  return normalized;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

const timelineBucket = (date: Date, period: MarketPeriod) => {
  if (period === "all") return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  if (period === "90") return isoDay(weekStart(date));
  return isoDay(date);
};

const timelineLabel = (bucket: string, period: MarketPeriod) => {
  if (period === "all") {
    const [year, month] = bucket.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, 1)))
      .replace(".", "");
  }
  const date = new Date(`${bucket}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(date)
    .replace(".", "");
};

const periodStart = (period: MarketPeriod, now: Date) => {
  if (period === "all") return null;
  const days = Number(period);
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff;
};

/**
 * Consolida a inteligência de mercado no servidor. A interface recebe apenas
 * agregados prontos para renderizar, sem descarregar a base inteira no browser.
 */
export function buildMarketIntelligence(
  jobs: MarketJob[],
  filters: MarketFilters,
  options: BuildOptions = {},
) {
  const now = options.now ?? new Date();
  const cutoff = periodStart(filters.period, now);
  const scoped = jobs.filter(job =>
    (!cutoff || jobDate(job) >= cutoff) &&
    (filters.source === "all" ||
      (filters.source === "unidentified" ? job.sourceId === null : job.sourceId === filters.source)) &&
    (filters.area === "all" || job.roleArea === filters.area),
  );
  const total = scoped.length;
  const sourceCounts = new Map<string, { id: string; label: string; count: number }>();
  for (const job of jobs) {
    const id = job.sourceId ?? "unidentified";
    const current = sourceCounts.get(id);
    sourceCounts.set(id, {
      id,
      label: job.sourceName ?? "Importação manual",
      count: (current?.count ?? 0) + 1,
    });
  }
  const sourceOptions = [...sourceCounts.values()]
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "pt-BR"))
    .map(option => ({ ...option, share: jobs.length ? Math.round((option.count / jobs.length) * 100) : 0 }));
  const skills = metricList(scoped.flatMap(job => parseStack(job.stack)), total, 10);
  // Ausências ficam explícitas no indicador de qualidade; não devem ocupar
  // espaço no ranking geográfico, que precisa mostrar somente localidades.
  const locations = metricList(scoped.flatMap(job => job.location?.trim() ? [job.location] : []), total);
  const areas = metricList(scoped.map(job => areaLabel(job.roleArea)), total);
  const workModes = metricList(scoped.flatMap(job => job.workMode?.trim() ? [job.workMode] : []), total);
  const sources = metricList(scoped.map(job => job.sourceName ?? "Importação manual"), total);
  const companies = metricList(scoped.map(job => job.company), total);
  const buckets = new Map<string, number>();
  for (const job of scoped) {
    const bucket = timelineBucket(jobDate(job), filters.period);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  const trendLimit = filters.period === "7" ? 7 : filters.period === "30" ? 15 : 12;
  const trend = [...buckets]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-trendLimit)
    .map(([bucket, count]) => ({ bucket, label: timelineLabel(bucket, filters.period), count }));
  const active = scoped.filter(job => job.status === "active").length;
  const descriptions = scoped.filter(job => job.description.trim().length >= 80).length;
  const locationsPresent = scoped.filter(job => Boolean(job.location?.trim())).length;
  const stacksPresent = scoped.filter(job => parseStack(job.stack).length > 0).length;
  const recentCutoff = new Date(now.getTime() - 7 * 86_400_000);
  const newLastSevenDays = scoped.filter(job => {
    const receivedAt = asDate(job.firstSeenAt);
    return Boolean(receivedAt && receivedAt >= recentCutoff);
  }).length;
  const insights = total === 0
    ? ["Não há vagas para os filtros escolhidos. Amplie o período ou ajuste a origem e a área."]
    : [
        skills[0] ? `${skills[0].label} aparece em ${skills[0].share}% das vagas do recorte.` : "Ainda não há tecnologias estruturadas suficientes neste recorte.",
        areas[0] ? `${areas[0].label} é a área com maior volume de oportunidades no período.` : "As vagas ainda não têm área profissional classificada.",
        locations[0] ? `${locations[0].label} concentra a maior parcela das localizações registradas.` : "As localizações ainda precisam de mais preenchimento.",
      ];

  return {
    generatedAt: now.toISOString(),
    filters,
    limited: Boolean(options.limited),
    sampleLimit: options.sampleLimit ?? null,
    summary: {
      total,
      active,
      companies: new Set(scoped.map(job => job.company.trim()).filter(Boolean)).size,
      newLastSevenDays,
      descriptions,
      locationsPresent,
      stacksPresent,
    },
    sourceOptions,
    trend,
    breakdowns: { skills, locations, areas, workModes, sources, companies },
    insights,
    dataAvailability: {
      salary: false,
      contract: false,
      sector: false,
    },
  };
}
