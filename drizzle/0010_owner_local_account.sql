INSERT INTO `local_accounts` (`user_id`, `email`, `name`, `password_hash`, `password_salt`, `created_by`, `created_at`, `updated_at`)
SELECT
  'radar-local-admin',
  'alexsandro.ramos@gmail.com',
  'Alex Ramos',
  'k_PyJKA0dhnc8cwMo-czWL1tagPhj_Zjrw1ogOtwpQ8',
  'n3iNxUazUaoPNF7kazt1xg',
  NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (
  SELECT 1 FROM `local_accounts` WHERE `user_id` = 'radar-local-admin' OR lower(`email`) = 'alexsandro.ramos@gmail.com'
);
