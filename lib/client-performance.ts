"use client";

type MetricName = "ttfb" | "fcp" | "lcp" | "cls" | "inp";
const SAMPLE_RATE = 0.1;
const allowed = new Set<MetricName>(["ttfb", "fcp", "lcp", "cls", "inp"]);

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
