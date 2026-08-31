export type ParsedMaintenanceQuantity = { valid: true; limit?: number } | { valid: false };

/** Quantidade vazia significa todo o recorte; não existe teto fixo. */
export function parseMaintenanceQuantity(value: unknown): ParsedMaintenanceQuantity {
  if (value === undefined || value === null || value === "") return { valid: true };
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return { valid: false };
  return { valid: true, limit: value };
}

export function selectedMaintenanceQuantity(value: string, eligible: number) {
  if (!value) return eligible;
  const requested = Number(value);
  if (!Number.isSafeInteger(requested) || requested < 1) return 0;
  return Math.min(eligible, requested);
}
