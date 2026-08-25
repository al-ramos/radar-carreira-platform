import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("a política de arquivamento prioriza a publicação na fonte e não permite reativação por importação", async () => {
  const [policy, push, collect, migration, boundaryMigration] = await Promise.all([
    readFile(new URL("../lib/job-archive-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/collector/import/[sourceId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/collect/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0039_archive_jobs_before_2026_08_15_by_source_date.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0040_archive_cutoff_sao_paulo_boundary.sql", import.meta.url), "utf8"),
  ]);
  assert.match(policy, /sourcePublishedAt \?\? receivedAt/);
  assert.match(policy, /2026-08-15/);
  assert.match(push, /case when \$\{jobs\.status\} = 'archived' then 'archived'/);
  assert.match(collect, /case when \$\{jobs\.status\} = 'archived' then 'archived'/);
  assert.match(migration, /coalesce\(`source_published_at`, `first_seen_at`\)/);
  assert.doesNotMatch(migration, /DELETE FROM/);
  assert.match(boundaryMigration, /1786762800000/);
  assert.doesNotMatch(boundaryMigration, /DELETE FROM/);
});
