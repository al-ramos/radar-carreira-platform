PRAGMA index_list('jobs');

EXPLAIN QUERY PLAN
SELECT id
FROM jobs
WHERE status = 'active' AND first_seen_at >= 0
ORDER BY first_seen_at DESC
LIMIT 50;

EXPLAIN QUERY PLAN
SELECT id
FROM jobs
WHERE status = 'active' AND source_id = 'apinfo-extension' AND first_seen_at >= 0
ORDER BY first_seen_at DESC
LIMIT 50;

EXPLAIN QUERY PLAN
SELECT job_id, application_status
FROM user_job_status
WHERE user_id = 'query-plan-audit' AND application_status IS NOT NULL;

EXPLAIN QUERY PLAN
SELECT metric, value, created_at
FROM performance_samples
WHERE created_at >= 0
ORDER BY created_at DESC
LIMIT 5000;

EXPLAIN QUERY PLAN
SELECT *
FROM triage_batch_items
WHERE batch_id IN ('query-plan-audit');
