CREATE TABLE `queue_daily_usage` (
	`day_utc` text NOT NULL,
	`queue` text NOT NULL,
	`reserved_operations` integer NOT NULL DEFAULT 0,
	`emitted_messages` integer NOT NULL DEFAULT 0,
	`retry_operations` integer NOT NULL DEFAULT 0,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`day_utc`, `queue`)
);
