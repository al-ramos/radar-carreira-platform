ALTER TABLE `jobs` ADD `ingestion_channel` text NOT NULL DEFAULT 'file';
--> statement-breakpoint
ALTER TABLE `jobs` ADD `role_area` text NOT NULL DEFAULT 'other';
--> statement-breakpoint
ALTER TABLE `import_runs` ADD `source_id` text REFERENCES `job_sources`(`id`);
--> statement-breakpoint
ALTER TABLE `import_runs` ADD `channel` text NOT NULL DEFAULT 'api';
--> statement-breakpoint
CREATE TABLE `job_import_runs` (
  `run_id` text NOT NULL REFERENCES `import_runs`(`id`),
  `job_id` text NOT NULL REFERENCES `jobs`(`id`),
  `outcome` text NOT NULL,
  `received_at` integer NOT NULL,
  PRIMARY KEY (`run_id`, `job_id`)
);
--> statement-breakpoint
UPDATE `jobs` SET `ingestion_channel` = CASE
  WHEN `source_id` IN ('linkedin-extension', 'apinfo-extension') THEN 'extension'
  WHEN `source_id` = 'gmail-radarvagas' THEN 'email'
  WHEN `source_id` IS NOT NULL THEN 'connector'
  ELSE 'file'
END;
--> statement-breakpoint
UPDATE `jobs` SET `role_area` = CASE
  WHEN lower(`title`) LIKE '%fullstack%' OR lower(`title`) LIKE '%full stack%' THEN 'fullstack'
  WHEN lower(`title`) LIKE '%devops%' OR lower(`title`) LIKE '%devsecops%' OR lower(`title`) LIKE '%sre%' OR lower(`title`) LIKE '%cloud%' THEN 'devops'
  WHEN lower(`title`) LIKE '%security%' OR lower(`title`) LIKE '%segurança%' OR lower(`title`) LIKE '%cyber%' THEN 'security'
  WHEN lower(`title`) LIKE '%dados%' OR lower(`title`) LIKE '%data %' OR lower(`title`) LIKE '%analytics%' OR lower(`title`) LIKE '%machine learning%' OR lower(`title`) LIKE '%business intelligence%' THEN 'data'
  WHEN lower(`title`) LIKE '%mobile%' OR lower(`title`) LIKE '%android%' OR lower(`title`) LIKE '%ios%' THEN 'mobile'
  WHEN lower(`title`) LIKE '%quality%' OR lower(`title`) LIKE '%qa%' OR lower(`title`) LIKE '%teste%' THEN 'qa'
  WHEN lower(`title`) LIKE '%frontend%' OR lower(`title`) LIKE '%front-end%' OR lower(`title`) LIKE '%front end%' THEN 'frontend'
  WHEN lower(`title`) LIKE '%backend%' OR lower(`title`) LIKE '%back-end%' OR lower(`title`) LIKE '%back end%' OR lower(`title`) LIKE '%developer%' OR lower(`title`) LIKE '%desenvolvedor%' THEN 'backend'
  WHEN lower(`title`) LIKE '%infra%' OR lower(`title`) LIKE '%suporte%' OR lower(`title`) LIKE '%support%' THEN 'infrastructure'
  WHEN lower(`title`) LIKE '%product%' OR lower(`title`) LIKE '%ux%' THEN 'product'
  WHEN lower(`title`) LIKE '%manager%' OR lower(`title`) LIKE '%gerente%' OR lower(`title`) LIKE '%tech lead%' THEN 'management'
  ELSE 'other'
END;
--> statement-breakpoint
CREATE INDEX `jobs_source_area_channel_idx` ON `jobs` (`source_id`, `role_area`, `ingestion_channel`);
--> statement-breakpoint
CREATE INDEX `job_import_runs_job_idx` ON `job_import_runs` (`job_id`, `run_id`);
