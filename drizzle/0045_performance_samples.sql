CREATE TABLE `performance_samples` (
  `id` text PRIMARY KEY NOT NULL,
  `route` text NOT NULL,
  `metric` text NOT NULL,
  `value` real NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX `performance_samples_metric_created_idx`
  ON `performance_samples` (`metric`, `created_at`);

CREATE INDEX `performance_samples_created_idx`
  ON `performance_samples` (`created_at`);
