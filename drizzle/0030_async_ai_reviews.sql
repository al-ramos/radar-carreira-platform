ALTER TABLE `triage_ai_reviews` ADD COLUMN `finalization_queued_at` integer;
CREATE TABLE `triage_ai_review_chunks` (
  `id` text PRIMARY KEY NOT NULL,
  `review_id` text NOT NULL REFERENCES `triage_ai_reviews`(`id`),
  `chunk_index` integer NOT NULL,
  `selection` text NOT NULL,
  `response` text,
  `status` text NOT NULL DEFAULT 'queued',
  `error` text,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `input_tokens` integer NOT NULL DEFAULT 0,
  `output_tokens` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `triage_ai_review_chunks_review_index_idx` ON `triage_ai_review_chunks` (`review_id`,`chunk_index`);
CREATE INDEX `triage_ai_review_chunks_review_status_idx` ON `triage_ai_review_chunks` (`review_id`,`status`);
