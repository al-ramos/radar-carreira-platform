CREATE TABLE `alert_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`period_key` text NOT NULL,
	`status` text DEFAULT 'prepared' NOT NULL,
	`job_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `alert_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`min_score` integer DEFAULT 80 NOT NULL,
	`frequency` text DEFAULT 'daily' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `alert_reads` (
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`read_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `job_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`inserted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`duplicates` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`actor_user_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`type` text NOT NULL,
	`detail` text,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `job_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`external_ref` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`source_id` text,
	`external_id` text,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`seniority` text,
	`work_mode` text,
	`location` text,
	`stack` text DEFAULT '[]' NOT NULL,
	`published_at` integer,
	`url` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `job_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_fingerprint_unique` ON `jobs` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` text PRIMARY KEY DEFAULT 'global' NOT NULL,
	`collection_enabled` integer DEFAULT true NOT NULL,
	`email_import_enabled` integer DEFAULT true NOT NULL,
	`enrichment_enabled` integer DEFAULT true NOT NULL,
	`default_period` text DEFAULT '24' NOT NULL,
	`default_min_score` integer DEFAULT 70 NOT NULL,
	`stale_after_days` integer DEFAULT 7 NOT NULL,
	`retention_days` integer DEFAULT 180 NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'user' NOT NULL,
	`seniority` text,
	`preferred_mode` text,
	`cities` text DEFAULT '[]' NOT NULL,
	`mastered_skills` text DEFAULT '[]' NOT NULL,
	`desired_areas` text DEFAULT '[]' NOT NULL,
	`avoid_terms` text DEFAULT '[]' NOT NULL,
	`min_score` integer DEFAULT 60 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_job_status` (
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`stage` text DEFAULT 'new' NOT NULL,
	`note` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `job_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
