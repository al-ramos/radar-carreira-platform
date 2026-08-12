export type AiOperation = "extract_job" | "resolve_ambiguity" | "generate_email";

export type AiProviderStatus = {
  configured: boolean;
  provider: string | null;
  model: string | null;
};

/**
 * A integração permanece no servidor. O Radar só considera IA disponível
 * quando os três valores forem configurados no ambiente de produção.
 * Nenhuma credencial é devolvida ao navegador.
 */
export function getAiProviderStatus(): AiProviderStatus {
  const provider = process.env.AI_PROVIDER?.trim() || null;
  const model = process.env.AI_MODEL?.trim() || null;
  const hasSecret = Boolean(process.env.AI_API_KEY?.trim());
  return { configured: Boolean(provider && model && hasSecret), provider, model };
}
