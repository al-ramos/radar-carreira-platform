CREATE TABLE `profiles` (`user_id` text PRIMARY KEY NOT NULL,`email` text NOT NULL,`name` text,`role` text DEFAULT 'user' NOT NULL,`seniority` text,`preferred_mode` text,`cities` text DEFAULT '[]' NOT NULL,`mastered_skills` text DEFAULT '[]' NOT NULL,`desired_areas` text DEFAULT '[]' NOT NULL,`avoid_terms` text DEFAULT '[]' NOT NULL,`min_score` integer DEFAULT 60 NOT NULL,`updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `job_sources` (`id` text PRIMARY KEY NOT NULL,`name` text NOT NULL,`provider` text NOT NULL,`external_ref` text NOT NULL,`enabled` integer DEFAULT true NOT NULL,`last_run_at` integer,`created_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `jobs` (`id` text PRIMARY KEY NOT NULL,`fingerprint` text NOT NULL,`source_id` text,`external_id` text,`company` text NOT NULL,`title` text NOT NULL,`seniority` text,`work_mode` text,`location` text,`stack` text DEFAULT '[]' NOT NULL,`published_at` integer,`url` text NOT NULL,`description` text DEFAULT '' NOT NULL,`first_seen_at` integer NOT NULL,`last_seen_at` integer NOT NULL,`status` text DEFAULT 'active' NOT NULL,`created_at` integer NOT NULL,`updated_at` integer NOT NULL,FOREIGN KEY (`source_id`) REFERENCES `job_sources`(`id`) ON UPDATE no action ON DELETE no action);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_fingerprint_unique` ON `jobs` (`fingerprint`);
--> statement-breakpoint
CREATE INDEX `idx_jobs_status_published` ON `jobs` (`status`,`published_at`);
--> statement-breakpoint
CREATE TABLE `user_job_status` (`user_id` text NOT NULL,`job_id` text NOT NULL,`stage` text DEFAULT 'new' NOT NULL,`note` text,`updated_at` integer NOT NULL,PRIMARY KEY(`user_id`,`job_id`),FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action);
--> statement-breakpoint
CREATE TABLE `job_events` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`job_id` text NOT NULL,`type` text NOT NULL,`detail` text,`occurred_at` integer NOT NULL,FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action);
--> statement-breakpoint
CREATE TABLE `import_runs` (`id` text PRIMARY KEY NOT NULL,`source` text NOT NULL,`status` text NOT NULL,`received` integer DEFAULT 0 NOT NULL,`inserted` integer DEFAULT 0 NOT NULL,`updated` integer DEFAULT 0 NOT NULL,`duplicates` integer DEFAULT 0 NOT NULL,`errors` integer DEFAULT 0 NOT NULL,`actor_user_id` text,`started_at` integer NOT NULL,`finished_at` integer);
--> statement-breakpoint
CREATE INDEX `idx_import_runs_started` ON `import_runs` (`started_at`);
--> statement-breakpoint
PRAGMA optimize;
