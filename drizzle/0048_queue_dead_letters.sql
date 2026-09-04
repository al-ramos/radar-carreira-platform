-- As três filas declaram dead_letter_queue, mas nenhuma DLQ tinha consumidor:
-- a mensagem que falhava três vezes saía da fila principal e sumia da visão de
-- quem opera. Esta tabela guarda a mensagem morta, com o payload íntegro, para
-- que ela possa ser consultada e devolvida à fila de origem.
CREATE TABLE `queue_dead_letters` (
	`id` text PRIMARY KEY NOT NULL,
	`queue` text NOT NULL,
	`kind` text,
	`job_id` text,
	`batch_id` text,
	`user_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE INDEX `queue_dead_letters_status_idx` ON `queue_dead_letters` (`status`,`created_at`);
