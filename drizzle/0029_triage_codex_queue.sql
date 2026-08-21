ALTER TABLE `triage_ai_reviews` ADD `destination` text NOT NULL DEFAULT 'portal';
--> statement-breakpoint
ALTER TABLE `triage_ai_reviews` ADD `codex_status` text;
--> statement-breakpoint
ALTER TABLE `triage_ai_reviews` ADD `codex_claimed_at` integer;
--> statement-breakpoint
ALTER TABLE `triage_ai_reviews` ADD `codex_completed_at` integer;
--> statement-breakpoint
CREATE INDEX `triage_ai_reviews_codex_queue_idx` ON `triage_ai_reviews` (`user_id`,`destination`,`codex_status`,`created_at`);
