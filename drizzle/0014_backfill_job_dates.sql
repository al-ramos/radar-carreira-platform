-- Fontes que não informam a publicação ainda precisam de uma data confiável
-- para aparecer no Radar. A primeira coleta é o melhor registro disponível.
UPDATE jobs
SET published_at = first_seen_at
WHERE published_at IS NULL;
