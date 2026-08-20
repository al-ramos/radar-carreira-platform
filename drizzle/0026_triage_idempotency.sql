ALTER TABLE `triage_batch_items` ADD `attempt_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `triage_batch_items` ADD `lease_owner` text;
--> statement-breakpoint
ALTER TABLE `triage_batch_items` ADD `lease_until` integer;
--> statement-breakpoint
CREATE TABLE `triage_deduplication` (`idempotency_key` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `job_id` text NOT NULL, `profile_revision` text NOT NULL, `rules_revision` text NOT NULL, `instructions_revision` text NOT NULL, `status` text NOT NULL, `history_id` text, `lease_owner` text, `lease_until` integer, `attempt_count` integer NOT NULL DEFAULT 0, `error` text, `updated_at` integer NOT NULL, FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`), FOREIGN KEY (`history_id`) REFERENCES `triage_history`(`id`));
--> statement-breakpoint
CREATE INDEX `triage_deduplication_lease_idx` ON `triage_deduplication` (`status`,`lease_until`);
