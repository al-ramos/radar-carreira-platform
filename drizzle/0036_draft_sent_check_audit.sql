-- A última checagem no Gmail é persistida para que cada vaga informe se já
-- houve envio. O contador dá rastreabilidade sem criar um evento a cada 15 min.
ALTER TABLE `draft_outbox` ADD `last_sent_check_at` integer;
ALTER TABLE `draft_outbox` ADD `last_sent_check_result` text;
ALTER TABLE `draft_outbox` ADD `sent_check_count` integer NOT NULL DEFAULT 0;
