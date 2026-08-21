export type TriageTrigger = "portal" | "schedule" | "gpt";
export type TriageAiMode = "off" | "ambiguous" | "all";
export type TriageDateScope = "received" | "published";

export type TriageRunRequest = {
  trigger: TriageTrigger;
  referenceDate?: string;
  /** Fonte opcional para uma execução manual excepcional e auditável. */
  sourceId?: string;
  /** Escolhe se o recorte diário usa entrada no Radar ou publicação na fonte. */
  dateScope?: TriageDateScope;
  batchSize?: number;
  reprocess?: boolean;
  aiMode?: TriageAiMode;
  createDrafts?: boolean;
};

export type NormalizedTriageRunRequest = Required<Omit<TriageRunRequest, "referenceDate" | "sourceId">> & { referenceDate: string; sourceId?: string };

function saoPauloDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Janela civil do dia no fuso do Radar. Evita depender do parse ambíguo de
 * 24:00 e mantém o recorte da rotina agendada separado de UTC. */
export function saoPauloDayWindow(referenceDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) throw new Error("referenceDate deve usar YYYY-MM-DD");
  const start = new Date(`${referenceDate}T00:00:00-03:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function normalizeTriageRunRequest(request: TriageRunRequest, now = new Date()): NormalizedTriageRunRequest {
  const referenceDate = request.referenceDate ?? saoPauloDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) throw new Error("referenceDate deve usar YYYY-MM-DD");
  const batchSize = Math.max(1, Math.min(100, Math.floor(request.batchSize ?? 10)));
  const sourceId = request.sourceId?.trim();
  const dateScope = request.dateScope ?? (request.trigger === "schedule" ? "received" : "published");
  if (dateScope !== "received" && dateScope !== "published") throw new Error("dateScope deve ser received ou published");
  return {
    trigger: request.trigger, referenceDate, batchSize, reprocess: request.reprocess ?? false,
    aiMode: request.aiMode ?? "ambiguous", createDrafts: request.createDrafts ?? false, dateScope,
    ...(sourceId && sourceId !== "all" ? { sourceId } : {}),
  };
}
