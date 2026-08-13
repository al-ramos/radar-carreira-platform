export const PIPELINE_STAGES = ["viewed", "saved", "applied", "interview", "offer", "rejected", "archived"] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];
export type AutomaticPipelineStage = "viewed" | "saved" | "applied";
export type AutomaticPipelineAction =
  | "view"
  | "analyze"
  | "apply"
  | "copy_email"
  | "open_outlook"
  | "mark_sent"
  | "forward";

export const AUTOMATIC_ACTION_STAGE = {
  view: "viewed",
  analyze: "saved",
  apply: "applied",
  copy_email: "saved",
  open_outlook: "applied",
  mark_sent: "applied",
  forward: "saved",
} as const satisfies Record<AutomaticPipelineAction, AutomaticPipelineStage>;

const ACTIVE_STAGE_RANK: Partial<Record<PipelineStage, number>> = {
  viewed: 0,
  saved: 1,
  applied: 2,
  interview: 3,
  offer: 4,
};

/**
 * Ações automáticas só avançam o acompanhamento. Mudanças deliberadas no
 * dropdown continuam podendo mover a vaga para qualquer estágio.
 */
export function resolveAutomaticStage(
  current: string | null | undefined,
  requested: AutomaticPipelineStage,
): PipelineStage {
  if (current === "rejected" || current === "archived") return current;
  if (!(current && current in ACTIVE_STAGE_RANK)) return requested;
  return (ACTIVE_STAGE_RANK[current as PipelineStage] ?? -1) >= ACTIVE_STAGE_RANK[requested]!
    ? current as PipelineStage
    : requested;
}
