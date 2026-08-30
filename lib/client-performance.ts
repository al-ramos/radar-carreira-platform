"use client";

type MetricName =
  | "ttfb" | "fcp" | "lcp" | "cls" | "inp"
  | "jobs_api_duration" | "jobs_api_server" | "jobs_api_bytes"
  | "jobs_meta_duration" | "jobs_meta_server" | "jobs_meta_bytes";
const SAMPLE_RATE = 0.1;
const allowed = new Set<MetricName>([
  "ttfb", "fcp", "lcp", "cls", "inp",
  "jobs_api_duration", "jobs_api_server", "jobs_api_bytes",
  "jobs_meta_duration", "jobs_meta_server", "jobs_meta_bytes",
]);

/** Mede uma amostra de sessões sem enviar vaga, descrição ou identificador. */
export function observeRadarPerformance(route: "dashboard") {
  if (typeof window === "undefined" || Math.random() > SAMPLE_RATE || !("PerformanceObserver" in window)) return;
  const values = new Map<MetricName, number>();
  const record = (name: MetricName, value: number) => {
    if (allowed.has(name) && Number.isFinite(value) && value >= 0) values.set(name, Math.round(value * 100) / 100);
  };
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation) record("ttfb", navigation.responseStart - navigation.requestStart);
  const observers: PerformanceObserver[] = [];
  const observe = (type: string, handler: (entry: PerformanceEntry) => void) => {
    try {
      const observer = new PerformanceObserver((list) => list.getEntries().forEach(handler));
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch { /* métrica não suportada neste navegador */ }
  };
  observe("paint", (entry) => { if (entry.name === "first-contentful-paint") record("fcp", entry.startTime); });
  observe("largest-contentful-paint", (entry) => record("lcp", entry.startTime));
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
    if (!shift.hadRecentInput) record("cls", (values.get("cls") ?? 0) + (shift.value ?? 0));
  });
  observe("event", (entry) => {
    const interaction = entry as PerformanceEntry & { duration?: number };
    if ((interaction.duration ?? 0) > 40) record("inp", Math.max(values.get("inp") ?? 0, interaction.duration ?? 0));
  });
  observe("resource", (entry) => {
    const resource = entry as PerformanceResourceTiming;
    const url = new URL(resource.name, window.location.href);
    if (url.pathname !== "/api/jobs") return;
    const prefix = url.searchParams.get("meta") === "only" ? "jobs_meta" : "jobs_api";
    record(`${prefix}_duration` as MetricName, resource.duration);
    record(`${prefix}_bytes` as MetricName, resource.transferSize || resource.encodedBodySize);
    const timingName = prefix === "jobs_meta" ? "radar-job-options" : "radar-jobs";
    const serverDuration = resource.serverTiming?.find((timing) => timing.name === timingName)?.duration;
    if (typeof serverDuration === "number") record(`${prefix}_server` as MetricName, serverDuration);
  });
  let sent = false;
  const flush = () => {
    if (sent || !values.size) return;
    sent = true;
    observers.forEach((observer) => observer.disconnect());
    const body = JSON.stringify({ route, metrics: [...values.entries()].map(([name, value]) => ({ name, value })) });
    void fetch("/api/telemetry/performance", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  };
  window.addEventListener("pagehide", flush, { once: true });
  window.setTimeout(flush, 10_000);
}
