-- As fontes padrão existem mesmo antes de uma extensão ser configurada. Isto
-- permite recuperar vagas históricas sem origem e mantém a referência válida.
INSERT OR IGNORE INTO `job_sources` (`id`, `name`, `provider`, `collection_mode`, `external_ref`, `enabled`, `consecutive_failures`, `created_at`)
VALUES
  ('linkedin-extension', 'Extensão LinkedIn', 'manual', 'push', '{}', false, 0, unixepoch() * 1000),
  ('apinfo-extension', 'Extensão APinfo', 'manual', 'push', '{}', false, 0, unixepoch() * 1000),
  ('other-import', 'Outras fontes', 'manual', 'push', '{}', true, 0, unixepoch() * 1000);
--> statement-breakpoint
-- A URL sempre permite atribuir pelo menos a categoria genérica. Não altere
-- registros que já possuem uma fonte explícita e rastreável.
UPDATE `jobs`
SET `source_id` = CASE
  WHEN lower(`url`) LIKE '%linkedin.com%' THEN 'linkedin-extension'
  WHEN lower(`url`) LIKE '%apinfo.com%' THEN 'apinfo-extension'
  ELSE 'other-import'
END
WHERE `source_id` IS NULL OR trim(`source_id`) = '';
