# Desempenho e observabilidade do Radar

## O que é medido

O portal coleta uma amostra anônima de 10% das sessões autenticadas. A amostra não contém usuário, vaga, descrição, URL ou conteúdo de candidatura.

- Web Vitals: TTFB, FCP, LCP, CLS e INP.
- Lista de vagas: duração no navegador, duração informada pelo Worker/D1 e bytes transferidos.
- Metadados dos filtros: duração no navegador, duração informada pelo Worker/D1 e bytes transferidos.

O Monitoramento apresenta p75 e p95 nas janelas de 24 horas e 7 dias. As amostras são eliminadas depois de 30 dias pelo agendamento do Worker.

## Auditoria dos planos D1

Execute a auditoria somente leitura com:

```powershell
npm run audit:d1
```

Em 30/08/2026, os planos remotos confirmaram:

- `jobs_status_first_seen_idx` para vagas ativas por recebimento;
- `jobs_status_source_first_seen_idx` para fonte e recebimento;
- `user_job_status_user_application_idx` como índice de cobertura para estados de candidatura;
- a chave primária de `triage_batch_items` para os lotes recentes;
- `performance_samples_created_idx` para a janela temporal de telemetria, após a migration `0045`.

Buscas textuais amplas continuam sendo uma ação explícita do usuário e não fazem parte da abertura inicial. FTS só deve ser introduzido se a telemetria demonstrar que essa consulta isolada virou gargalo, evitando custo de sincronização sem evidência.
