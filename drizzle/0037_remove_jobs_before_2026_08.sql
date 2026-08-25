-- Limpeza operacional solicitada: vagas publicadas antes de 01/08/2026.
-- A ordem preserva inclusive as relações da fila e do histórico de triagem.
DELETE FROM `draft_outbox` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `triage_deduplication` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `triage_batch_items` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `triage_history` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `alert_reads` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `user_job_status` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `user_job_analyses` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `job_ai_facts` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `job_ai_triage` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `ai_usage_events` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `job_events` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `job_import_runs` WHERE `job_id` IN (SELECT `id` FROM `jobs` WHERE `published_at` < 1785542400000);
DELETE FROM `jobs` WHERE `published_at` < 1785542400000;
