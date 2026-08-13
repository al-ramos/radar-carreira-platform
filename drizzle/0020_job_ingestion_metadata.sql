ALTER TABLE `jobs` ADD `source_published_at` integer;
--> statement-breakpoint
ALTER TABLE `jobs` ADD `ingestion_mode` text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
UPDATE `jobs`
SET `ingestion_mode` = 'automatic'
WHERE `source_id` IS NOT NULL
   OR `description` LIKE 'Importada do alerta RadarVagas:%';
--> statement-breakpoint
UPDATE `jobs`
SET `source_published_at` = `published_at`
WHERE `source_id` IS NOT NULL
  AND `source_id` NOT IN ('linkedin-extension', 'apinfo-extension', 'gmail-radarvagas');
--> statement-breakpoint
CREATE INDEX `jobs_ingestion_mode_first_seen_idx` ON `jobs` (`ingestion_mode`, `first_seen_at`);
--> statement-breakpoint
CREATE INDEX `jobs_first_seen_at_idx` ON `jobs` (`first_seen_at`);
