-- Arquivamento reversível: preserva triagem, rascunhos, candidaturas e auditoria.
-- A data da fonte é canônica; sem ela, usa-se o momento de recebimento.
UPDATE `jobs`
SET `status` = 'archived', `updated_at` = 1786780800000
WHERE `status` != 'archived'
  AND coalesce(`source_published_at`, `first_seen_at`) < 1786752000000;
