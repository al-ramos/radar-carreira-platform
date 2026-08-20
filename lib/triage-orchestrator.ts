export type TriageTrigger = "portal" | "schedule" | "gpt";
export type TriageAiMode = "off" | "ambiguous" | "all";

export type TriageRunRequest = {
  trigger: TriageTrigger;
  referenceDate?: string;
  /** Fonte opcional para uma execução manual excepcional e auditável. */
  sourceId?: string;
  batchSize?: number;
  reprocess?: boolean;
  aiMode?: TriageAiMode;
  createDrafts?: boolean;
};

export type NormalizedTriageRunRequest = Required<Omit<TriageRunRequest, "referenceDate" | "sourceId">> & { referenceDate: string; sourceId?: string };

function saoPauloDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function normalizeTriageRunRequest(request: TriageRunRequest, now = new Date()): NormalizedTriageRunRequest {
  const referenceDate = request.referenceDate ?? saoPauloDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) throw new Error("referenceDate deve usar YYYY-MM-DD");
  const batchSize = Math.max(1, Math.min(100, Math.floor(request.batchSize ?? 10)));
  const sourceId = request.sourceId?.trim();
  return {
    trigger: request.trigger, referenceDate, batchSize, reprocess: request.reprocess ?? false,
    aiMode: request.aiMode ?? "ambiguous", createDrafts: request.createDrafts ?? false,
    ...(sourceId && sourceId !== "all" ? { sourceId } : {}),
  };
}
