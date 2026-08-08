-- Reverte a decisão da migration 0007 (todo mundo virava admin).
-- Novas contas passam a nascer como "user"; o dono da plataforma
-- (alexsandro.ramos@gmail.com) continua sendo o único "admin" protegido
-- pelas rotas /api/admin/*.
UPDATE `profiles` SET `role` = 'user' WHERE `email` <> 'alexsandro.ramos@gmail.com';
