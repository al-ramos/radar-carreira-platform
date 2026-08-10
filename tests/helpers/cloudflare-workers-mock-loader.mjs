// Module loader mínimo: intercepta o import de "cloudflare:workers" (que só
// existe dentro do runtime do Cloudflare Worker) e devolve um objeto `env`
// vazio. `db/index.ts` só usa `env.DB` para checar se o binding existe —
// os testes de RBAC não passam por `getDb()` real, então isso nunca é lido.
// Necessário só para que `import { env } from "cloudflare:workers"` não
// quebre a resolução de módulo ao rodar `lib/access.ts` fora do Worker.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: "cloudflare-workers-mock:env", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === "cloudflare-workers-mock:env") {
    return {
      format: "module",
      shortCircuit: true,
      source: "export const env = {};",
    };
  }
  return nextLoad(url, context);
}
