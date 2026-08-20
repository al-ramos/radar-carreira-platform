CREATE TABLE `triage_batches` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `trigger` text NOT NULL, `scope` text NOT NULL, `status` text NOT NULL DEFAULT 'queued', `started_at` integer, `completed_at` integer, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX `triage_batches_user_created_idx` ON `triage_batches` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `triage_history` (`id` text PRIMARY KEY NOT NULL, `batch_id` text NOT NULL, `user_id` text NOT NULL, `job_id` text NOT NULL, `profile_revision` text NOT NULL, `rules_revision` text NOT NULL, `instructions_revision` text NOT NULL, `verdict` text NOT NULL, `label` text NOT NULL, `blocker` text, `source` text NOT NULL, `confidence` integer NOT NULL, `rows` text NOT NULL DEFAULT '[]', `created_at` integer NOT NULL, FOREIGN KEY (`batch_id`) REFERENCES `triage_batches`(`id`), FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`));
--> statement-breakpoint
CREATE INDEX `triage_history_user_job_created_idx` ON `triage_history` (`user_id`,`job_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `triage_history_batch_idx` ON `triage_history` (`batch_id`);
--> statement-breakpoint
CREATE TABLE `triage_batch_items` (`batch_id` text NOT NULL, `job_id` text NOT NULL, `status` text NOT NULL DEFAULT 'queued', `history_id` text, `error` text, `updated_at` integer NOT NULL, PRIMARY KEY (`batch_id`,`job_id`), FOREIGN KEY (`batch_id`) REFERENCES `triage_batches`(`id`), FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`), FOREIGN KEY (`history_id`) REFERENCES `triage_history`(`id`));
--> statement-breakpoint
CREATE INDEX `triage_batch_items_status_idx` ON `triage_batch_items` (`batch_id`,`status`);
--> statement-breakpoint
CREATE TABLE `draft_outbox` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `job_id` text NOT NULL, `history_id` text NOT NULL, `status` text NOT NULL DEFAULT 'pending', `gmail_draft_id` text, `error` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`), FOREIGN KEY (`history_id`) REFERENCES `triage_history`(`id`));
--> statement-breakpoint
CREATE UNIQUE INDEX `draft_outbox_user_job_unique` ON `draft_outbox` (`user_id`,`job_id`);
--> statement-breakpoint
CREATE INDEX `draft_outbox_status_idx` ON `draft_outbox` (`user_id`,`status`);
