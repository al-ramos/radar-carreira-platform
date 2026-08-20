ALTER TABLE `user_job_analyses` ADD `profile_revision` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `user_job_analyses` ADD `rules_revision` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `user_job_analyses` ADD `instructions_revision` text NOT NULL DEFAULT 'legacy';
