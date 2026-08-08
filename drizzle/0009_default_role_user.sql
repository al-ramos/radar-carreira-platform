CREATE TABLE `profiles_new` (
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
INSERT INTO `profiles_new` (`user_id`, `email`, `name`, `role`, `seniority`, `preferred_mode`, `cities`, `mastered_skills`, `desired_areas`, `avoid_terms`, `min_score`, `updated_at`)
SELECT `user_id`, `email`, `name`, CASE WHEN lower(`email`) = 'alexsandro.ramos@gmail.com' THEN 'admin' ELSE 'user' END, `seniority`, `preferred_mode`, `cities`, `mastered_skills`, `desired_areas`, `avoid_terms`, `min_score`, `updated_at`
FROM `profiles`;
--> statement-breakpoint
DROP TABLE `profiles`;
--> statement-breakpoint
ALTER TABLE `profiles_new` RENAME TO `profiles`;
