import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

// T1 — as três filas declaravam dead_letter_queue sem nenhum consumidor:
// depois de max_retries a mensagem saía da fila principal e desaparecia.
test("cada dead letter queue declarada tem consumidor", async () => {
  const raw = await read("../wrangler.jsonc");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));
  const consumidas = new Set(config.queues.consumers.map(consumer => consumer.queue));
  const dlqs = config.queues.consumers.map(consumer => consumer.dead_letter_queue).filter(Boolean);
  assert.ok(dlqs.length >= 3, "as filas principais devem declarar DLQ");
  for (const dlq of dlqs) {
    assert.ok(consumidas.has(dlq), `dead letter queue sem consumidor: ${dlq}`);
  }
  // O consumidor da DLQ apenas registra. As tentativas existem para uma falha
  // de escrita no D1, não para reprocessar o trabalho original — e a DLQ não
  // encadeia outra DLQ, senão o item circularia entre filas.
  for (const consumer of config.queues.consumers.filter(item => item.queue.endsWith("-dlq"))) {
    assert.equal(consumer.max_retries, 3, `${consumer.queue} deve tolerar falha transitória de escrita`);
    assert.ok(!consumer.dead_letter_queue, `${consumer.queue} não deve encadear outra DLQ`);
  }
});

test("o worker persiste a mensagem morta com payload íntegro", async () => {
  const worker = await read("../worker/index.ts");
  assert.match(worker, /const DEAD_LETTER_QUEUES: Record<string, string> = \{/);
  assert.match(worker, /async function recordDeadLetters\(env: Env, queue: string, origin: string, messages: QueueMessage\[\]\)/);
  assert.match(worker, /INSERT INTO queue_dead_letters/);
  assert.match(worker, /JSON\.stringify\(message\.body\)/);
  // Falha ao registrar devolve à DLQ em vez de perder o item.
  assert.match(worker, /queue_dead_letter_record_failed[\s\S]{0,220}message\.retry/);
  // O roteamento acontece antes do laço normal de processamento.
  assert.ok(worker.indexOf("const deadLetterOrigin = batch.queue") < worker.indexOf("for (const message of batch.messages)"));
});

test("a tabela de mensagens mortas tem migration e índice", async () => {
  const [schema, migration] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0048_queue_dead_letters.sql"),
  ]);
  assert.match(schema, /export const queueDeadLetters = sqliteTable\("queue_dead_letters"/);
  assert.match(schema, /payload: text\("payload"\)\.notNull\(\)/);
  assert.match(schema, /status: text\("status", \{ enum: \["pending", "requeued", "dismissed"\] \}\)/);
  assert.match(migration, /CREATE TABLE `queue_dead_letters`/);
  assert.match(migration, /CREATE INDEX `queue_dead_letters_status_idx`/);
});

test("o reenfileiramento é explícito, limitado e respeita a cota de filas", async () => {
  const route = await read("../app/api/admin/dead-letters/route.ts");
  assert.match(route, /const MAX_REQUEUE = 25/);
  assert.match(route, /reserveQueueMessages\(db, "dead-letter-requeue", rows\.length\)/);
  assert.match(route, /if \(!reservation\.allowed\)/);
  assert.match(route, /can\(user, "monitor\.view"\)/);
  // Nada reprocessa sozinho: só há reenfileiramento sob POST explícito.
  assert.doesNotMatch(route, /setInterval|setTimeout/);
  // A DLQ não carrega o erro; a resposta diz isso em vez de inventar um motivo.
  assert.match(route, /A fila não transporta o erro da tentativa/);
});

test("a tela lista as mensagens mortas e separa reenfileirar de arquivar", async () => {
  const ui = await read("../app/Monitoring.tsx");
  assert.match(ui, /Mensagens mortas/);
  assert.match(ui, /treatDeadLetters\("requeue", \[item\.id\]\)/);
  assert.match(ui, /treatDeadLetters\("dismiss", \[item\.id\]\)/);
  assert.match(ui, /Nenhuma mensagem morta pendente/);
});
