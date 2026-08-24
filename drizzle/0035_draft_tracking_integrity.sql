-- Um mesmo rascunho do Gmail não pode representar duas vagas. Corrige o
-- estado legado mais fraco antes de tornar a associação única.
WITH ranked_drafts AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY gmail_draft_id
    ORDER BY CASE status WHEN 'sent' THEN 0 WHEN 'drafted' THEN 1 ELSE 2 END, updated_at DESC, id
  ) AS position
  FROM draft_outbox
  WHERE gmail_draft_id IS NOT NULL
)
UPDATE draft_outbox
SET status = 'cancelled',
    gmail_draft_id = NULL,
    gmail_thread_id = NULL,
    error = 'Rascunho duplicado removido: o mesmo identificador do Gmail já estava vinculado a outra vaga.',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id IN (SELECT id FROM ranked_drafts WHERE position > 1);

CREATE UNIQUE INDEX `draft_outbox_gmail_draft_unique` ON `draft_outbox` (`gmail_draft_id`);
