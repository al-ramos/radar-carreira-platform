ALTER TABLE `user_job_analyses` ADD `score` integer;
--> statement-breakpoint
CREATE INDEX `jobs_status_first_seen_idx` ON `jobs` (`status`, `first_seen_at`);
--> statement-breakpoint
CREATE INDEX `jobs_status_source_first_seen_idx` ON `jobs` (`status`, `source_id`, `first_seen_at`);
--> statement-breakpoint
CREATE INDEX `user_job_status_user_application_idx` ON `user_job_status` (`user_id`, `application_status`, `job_id`);
