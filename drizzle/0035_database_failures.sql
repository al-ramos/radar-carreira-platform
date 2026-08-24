CREATE TABLE `database_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`impact` text NOT NULL,
	`error` text NOT NULL,
	`correlation_id` text,
	`occurred_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `database_failures_occurred_at_idx` ON `database_failures` (`occurred_at`);
