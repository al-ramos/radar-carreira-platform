# Radar Carreira Platform

Nova geração do Radar de Vagas: plataforma multiusuário para coletar oportunidades, explicar a aderência e acompanhar candidaturas.

## Nesta versão

- dashboard responsivo com busca e filtro de score;
- perfis de candidato e administrador;
- vagas e descrições persistidas no banco;
- fontes Greenhouse, Lever, Ashby, JSON-LD, feed JSON e manual;
- deduplicação por `fingerprint`;
- histórico de vagas e importações;
- pipeline individual por usuário;
- score explicável por stack, área, senioridade, local/modalidade e atualidade;
- bloqueio por termos indesejados.

## Stack

Next.js 16, React 19, TypeScript, vinext/Vite, Tailwind CSS, Drizzle ORM e Cloudflare D1. Autenticação preparada para Sign in with ChatGPT no OpenAI Sites.

## Executar

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`. A interface usa dados demonstrativos até o D1 ser configurado.

## Banco

O schema em `db/schema.ts` inclui `profiles`, `job_sources`, `jobs`, `user_job_status`, `job_events` e `import_runs`.

```bash
npm run db:generate
```

## Próximas entregas

1. APIs D1 para painel e importação;
2. login e provisionamento do administrador;
3. conectores ATS e importação JSON/CSV;
4. coleta agendada e detecção de vagas encerradas;
5. pipeline Kanban e notas;
6. alertas por e-mail/WhatsApp;
7. métricas de conversão, empresas e tecnologias;
8. testes e observabilidade.

O projeto reaproveita os melhores conceitos de `al-ramos/radar-vagas`, reestruturados para uma aplicação web multiusuário.
