import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const wranglerCli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const checks = [
  {
    label: "Vagas ativas por recebimento",
    expected: "jobs_status_first_seen_idx",
    sql: "SELECT id FROM jobs WHERE status = 'active' AND first_seen_at >= 0 ORDER BY first_seen_at DESC LIMIT 50",
  },
  {
    label: "Vagas por fonte e recebimento",
    expected: "jobs_status_source_first_seen_idx",
    sql: "SELECT id FROM jobs WHERE status = 'active' AND source_id = 'apinfo-extension' AND first_seen_at >= 0 ORDER BY first_seen_at DESC LIMIT 50",
  },
  {
    label: "Candidaturas por usuário",
    expected: "user_job_status_user_application_idx",
    sql: "SELECT job_id, application_status FROM user_job_status WHERE user_id = 'query-plan-audit' AND application_status IS NOT NULL",
  },
  {
    label: "Janela temporal da telemetria",
    expected: "performance_samples_created_idx",
    sql: "SELECT metric, value, created_at FROM performance_samples WHERE created_at >= 0 ORDER BY created_at DESC LIMIT 5000",
  },
  {
    label: "Itens dos lotes recentes",
    expected: "triage_batch_items_status_idx",
    sql: "SELECT * FROM triage_batch_items WHERE batch_id IN ('query-plan-audit')",
  },
];

let failed = false;
for (const check of checks) {
  const result = spawnSync(process.execPath, [wranglerCli,
    "d1", "execute", "radar-carreira-db", "--remote",
    "--command", `EXPLAIN QUERY PLAN ${check.sql}`, "--json",
  ], { encoding: "utf8", shell: false });
  if (result.status !== 0) {
    console.error(`${check.label}: Wrangler falhou.\n${result.error?.message ?? result.stderr ?? "erro desconhecido"}`);
    failed = true;
    continue;
  }
  const response = JSON.parse(result.stdout);
  const details = response.flatMap((entry) => entry.results ?? []).map((row) => row.detail).filter(Boolean);
  const passed = details.some((detail) => detail.includes(check.expected));
  console.log(`${passed ? "OK" : "FALHA"} · ${check.label} · ${details.join(" | ")}`);
  if (!passed) failed = true;
}

if (failed) process.exitCode = 1;
