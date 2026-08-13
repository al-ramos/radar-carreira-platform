const DB_INDEX_SPECIFIER_RE = /\/db\/index(\.(ts|js))?$/;
const FAKE_DB_INDEX_URL = new URL("./fake-db-index.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (DB_INDEX_SPECIFIER_RE.test(specifier)) {
    return { url: FAKE_DB_INDEX_URL, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // O projeto importa módulos TS relativos sem extensão (ex.: "../db/schema").
    // Sob loaders customizados o Node nem sempre resolve isso sozinho — tenta
    // de novo acrescentando ".ts" antes de propagar o erro original.
    if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
