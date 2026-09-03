import { d1QuotaResponse } from "./d1-quota";

/**
 * A tela de acesso nunca deve exibir o erro cru do navegador — por exemplo
 * "Failed to execute 'json' on 'Response': Unexpected end of JSON input".
 * Esse texto só aparece quando a rota falhou antes de escrever qualquer corpo:
 * ele não diz o que quebrou nem o que a pessoa deve fazer. As mensagens abaixo
 * cobrem os casos por status, e authFailureResponse garante que a rota sempre
 * responda JSON, mesmo quando o banco está fora.
 */
export const AUTH_SERVICE_UNAVAILABLE = "O serviço de contas está indisponível agora. Tente novamente em alguns minutos.";
export const AUTH_NETWORK_ERROR = "Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.";

export function authFailureMessage(status: number) {
  if (status === 429) return "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.";
  if (status >= 500) return `${AUTH_SERVICE_UNAVAILABLE} (erro ${status})`;
  return `Não foi possível concluir o acesso. Tente novamente. (erro ${status})`;
}

/** Converte qualquer falha inesperada da rota em JSON — nunca em corpo vazio. */
export function authFailureResponse(event: string, error: unknown) {
  console.error(JSON.stringify({ event, error: error instanceof Error ? error.message : String(error) }));
  return d1QuotaResponse(error) ?? Response.json(
    { error: AUTH_SERVICE_UNAVAILABLE, code: "RADAR_AUTH_UNAVAILABLE", retryable: true },
    { status: 503, headers: { "Retry-After": "60" } },
  );
}
