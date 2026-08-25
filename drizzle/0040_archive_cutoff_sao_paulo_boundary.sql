-- Corrige a borda do corte para 00:00 em São Paulo (UTC-03), sem remover
-- qualquer registro vinculado à vaga.
UPDATE `jobs`
SET `status` = 'archived', `updated_at` = 1786780800000
WHERE `status` != 'archived'
  AND coalesce(`source_published_at`, `first_seen_at`) < 1786762800000;
