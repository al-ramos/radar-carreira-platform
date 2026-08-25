import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("análise consultiva da IA persiste o prompt e o snapshot sem alterar a triagem", async () => {
  const [route, schema, provider, migration] = await Promise.all([
    readFile(new URL("../app/api/triage/ai-review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai-provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0028_triage_ai_reviews.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /MAX_ASYNC_AI_REVIEW_JOBS = 1000/);
  assert.match(route, /CHUNK_SIZE = 10/);
  assert.match(route, /AI_REVIEW_QUEUE/);
  assert.match(route, /triageAiReviewChunks/);
  assert.match(route, /triageAiReviews/);
  assert.match(route, /status: "queued"/);
  assert.match(route, /reviewProfile: AiReviewProfile/);
  assert.match(route, /profile: reviewProfile/);
  assert.match(route, /JSON\.stringify\(\{ profile: reviewProfile, jobs: reviewJobs \}\)/);
  assert.match(route, /status: "queued"/);
  assert.match(schema, /triageAiReviews/);
  assert.match(provider, /reviewSelectedJobs/);
  assert.match(provider, /export type AiReviewProfile/);
  assert.match(migration, /CREATE TABLE `triage_ai_reviews`/);
});
