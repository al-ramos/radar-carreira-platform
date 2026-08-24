CREATE TABLE `automation_heartbeats` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`error` text,
	`updated_at` integer NOT NULL
);
