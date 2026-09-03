
WITH queued AS (
  SELECT json_extract(item.value, '$.id') AS job_id
  FROM triage_ai_reviews review, json_each(review.selection, '$.jobs') item
  WHERE review.destination = 'codex' AND review.codex_status = 'pending'
)
SELECT jobs.external_id AS codigo, jobs.title, jobs.description, coalesce(jobs.stack, '') AS stack
FROM queued
JOIN jobs ON jobs.id = queued.job_id
ORDER BY CAST(jobs.external_id AS INTEGER), jobs.id