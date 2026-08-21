-- Remove somente avaliações/vereditos já registrados. Vagas, contatos,
-- candidaturas e rascunhos permanecem intactos; novos vereditos só surgem
-- quando a triagem manual for acionada.
DELETE FROM `user_job_analyses`;
--> statement-breakpoint
DELETE FROM `job_ai_triage`;
