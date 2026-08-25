-- Arquivamento solicitado: vagas publicadas antes de 15/08/2026.
-- Mantém todo o histórico ligado à vaga e a oculta permanentemente do Radar.
UPDATE `jobs` SET `status` = 'archived', `updated_at` = 1786752000000
WHERE `published_at` < 1786752000000;
