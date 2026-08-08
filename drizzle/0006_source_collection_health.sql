ALTER TABLE `job_sources` ADD `last_attempt_at` integer;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD `last_success_at` integer;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD `last_error` text;
--> statement-breakpoint
ALTER TABLE `job_sources` ADD `consecutive_failures` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `job_sources` SET `last_success_at` = `last_run_at` WHERE `last_run_at` IS NOT NULL;
