# Radar Carreira Platform

Portal multiusuário para reunir oportunidades, decidir quais vagas merecem atenção e acompanhar candidaturas em um único lugar. O produto combina coleta multicanal, aderência explicável, bloqueadores estratégicos, inteligência opcional por IA e operação administrativa.

**Produção:** [radar-carreira-platform.al-ramos.workers.dev](https://radar-carreira-platform.al-ramos.workers.dev)

**Documentação completa:** [visão do produto, arquitetura, recursos, regras de negócio, dados, APIs, segurança e operação](docs/visao-completa-do-projeto.md)

> O portal está público, mas o visitante precisa entrar (e-mail/senha ou, quando hospedado em `*.chatgpt.site`, Sign in with ChatGPT) para acessar as áreas identificadas.

## O que o portal faz

- reúne vagas recebidas por Gmail, extensões LinkedIn/APinfo, importação JSON/CSV e páginas públicas de carreiras;
- evita duplicações por `fingerprint` e identificador externo;
- exibe vagas paginadas das últimas 24 horas, 3 dias, 7 dias ou de todo o histórico;
- calcula um score explicável considerando competências, áreas, senioridade, modalidade, localização, atualidade e termos a evitar;
- aplica um veredito estratégico em quatro fases, com bloqueadores de stack, idioma, senioridade, atuação e geografia;
- oferece aprofundamento opcional por IA, com fatos verificáveis, cache, orçamento mensal e preparação para entrevista;
- mostra a descrição dentro do Radar, infere tecnologias e mantém separadas a URL estável e a URL de candidatura;
- permite copiar e compartilhar a descrição, exportar resultados e gerar uma mensagem de candidatura segura;
- mantém um pipeline individual com notas, etapas e marcos de mensagem gerada, enviada e respondida;
- envia um resumo diário por Gmail quando existem oportunidades acima do score mínimo;
- registra análises elegíveis, importações, eventos, consumo de IA, qualidade dos dados e ciclo de vida das vagas.

## Recursos disponíveis

### Para usuários

- Radar com busca por código ou texto, paginação e filtros de período, origem, pipeline, veredito e score;
- perfil profissional com competências, áreas, modalidades, senioridades e regras estratégicas de carreira;
- detalhe da vaga, tecnologias inferidas, score explicado e veredito em quatro fases;
- análise personalizada persistida somente para vagas elegíveis;
- aprofundamento opcional por IA e briefing de entrevista;
- acesso ao anúncio original, URL de candidatura e contato APinfo quando disponível;
- pipeline Kanban com notas e acompanhamento da candidatura;
- alertas e resumo diário;
- métricas pessoais de funil, conversão, empresas e tecnologias;
- exportação CSV compatível com Excel.

### Para administradores

- importação manual em JSON ou CSV;
- modelo CSV para download;
- cadastro e ativação de fontes Greenhouse, Lever e Ashby;
- coleta manual e agendada;
- integração Gmail `RadarVagas`;
- chaves protegidas para as extensões LinkedIn e APinfo;
- configurações e parâmetros operacionais;
- monitoramento de coletas;
- auditoria e qualidade dos dados;
- gestão de usuários, roles e permissões granulares;
- backup administrativo;
- relatório compatível com Excel.

## Como o Radar decide

O produto usa mecanismos complementares, cada um com uma finalidade:

| Mecanismo | Resultado | Finalidade |
|---|---|---|
| Score numérico | `0` a `100` | ordenar e filtrar oportunidades por aderência |
| Veredito estratégico | `✅`, `🟡`, `🔴` ou `❌` | aplicar preferências e bloqueadores pessoais em quatro fases |
| IA opcional | fatos, evidências, ambiguidades e perguntas | aprofundar o contexto sem substituir as regras determinísticas |

Vagas fora do escopo de TI continuam visíveis, mas não recebem aderência. Apenas vagas com veredito **Bate** ou **Provável com ressalvas** podem ser persistidas na análise e incluídas no acompanhamento. O estado da candidatura não regride: **mensagem gerada → enviada → respondida**.

## Fluxo dos dados

```text
Gmail/RadarVagas ─────┐
Extensões do navegador ├─> normalização e deduplicação ─> Cloudflare D1 ─> Radar e pipeline
JSON ou CSV ──────────┤                                  │
ATS públicos ─────────┘                                  ├─> score e veredito
                                                         └─> IA opcional, alertas e resumo diário
```

As senhas do Gmail não são armazenadas. O conector do Google Apps Script envia apenas mensagens recentes da etiqueta `RadarVagas`, usando uma chave exclusiva cujo hash fica registrado no banco.

## Stack

- Next.js 16 e React 19;
- TypeScript;
- vinext, Vite e Cloudflare Workers;
- Drizzle ORM e Cloudflare D1;
- Tailwind CSS e identidade visual em Geist;
- autenticação local e, em domínios `*.chatgpt.site`, Sign in with ChatGPT;
- provedor opcional compatível com OpenAI Chat Completions;
- GitHub Actions e Google Apps Script para automações.

## Executar localmente

Pré-requisitos:

- Node.js 22.13 ou superior;
- npm.

```bash
npm install
npm run dev
```

Use a URL exibida pelo servidor. As funcionalidades persistentes exigem o binding D1 `DB`; a aplicação não transforma falhas do banco em vagas demonstrativas.

Comandos úteis:

```bash
npm run build
npm test
npm run test:rbac-integration
npm run lint
npm run db:generate
```

`npm test` executa o build e a suíte regular, que combina testes de regras de negócio com verificações estruturais do código. `npm run test:rbac-integration` é separado: chama `can()` de `lib/rbac.ts` contra SQLite real em memória (`node:sqlite`), populado com as migrations `0010`/`0011`, usando loaders que simulam `cloudflare:workers` e o binding D1.

No Windows com Node.js 24, os loaders atuais podem montar um caminho inválido no formato `C:\C:\...`; o fluxo oficialmente configurado usa Node.js 22.

## Banco de dados

O projeto usa Cloudflare D1. O schema principal está em `db/schema.ts` e as migrações estão em `drizzle/`.

Principais tabelas:

- carreira e acesso: `profiles` e `local_accounts`;
- vagas e operação: `job_sources`, `jobs`, `job_events` e `import_runs`;
- acompanhamento: `user_job_status` e `user_job_analyses`;
- inteligência: `job_ai_facts` e `ai_usage_events`;
- alertas: `alert_preferences`, `alert_reads` e `alert_deliveries`;
- administração: `platform_settings`;
- RBAC: `roles`, `permissions`, `role_permissions`, `groups`, `group_roles`, `user_roles`, `user_groups` e `access_audit_log`.

O schema possui 22 tabelas. Preferências e resultados estruturados são armazenados como JSON textual quando apropriado para D1/SQLite. As chaves compostas usuário + vaga isolam pipeline, análise e leitura por pessoa.

Cada projeto publicado no Sites possui seu próprio banco D1. Publicar o mesmo código em um novo endereço não transfere automaticamente vagas, perfis, fontes ou configurações do banco anterior.

## Publicação contínua no Cloudflare

O GitHub Actions valida cada pull request e cada push na `main`. Depois de uma validação bem-sucedida na `main`, a esteira aplica migrations pendentes no D1 e publica o Worker no Cloudflare.

Antes do primeiro push com deploy, crie estes **Repository secrets** em `Settings` → `Secrets and variables` → `Actions` no GitHub:

- `CLOUDFLARE_API_TOKEN`: token da Cloudflare com permissão de edição para Workers e D1 na conta do projeto;
- `CLOUDFLARE_ACCOUNT_ID`: identificador da conta Cloudflare onde estão o Worker e o banco `radar-carreira-db`.

As credenciais não devem ser adicionadas a arquivos do repositório ou ao código-fonte. O binding `DB`, o ID do D1 e as migrations ficam em `wrangler.jsonc` e `drizzle/`.

Para ativar o aprofundamento opcional com IA, configure diretamente no ambiente do Worker `OPENAI_API_KEY` e `OPENAI_MODEL`. Alternativamente, `AI_API_KEY`, `AI_MODEL` e `AI_PROVIDER` permitem um provedor compatível com Chat Completions; `OPENAI_BASE_URL` ou `AI_BASE_URL` define um endpoint diferente. As regras determinísticas continuam funcionando sem essas variáveis. Cada perfil define seu limite mensal de tokens; resultados factuais são armazenados em cache por versão da descrição da vaga, e o uso devolvido pelo provedor é contabilizado no servidor.

## Integração Gmail RadarVagas

### 1. Preparar o Gmail

Crie ou mantenha uma etiqueta chamada exatamente `RadarVagas` e direcione para ela os alertas de vagas e candidaturas.

### 2. Registrar a chave no portal

Entre como administrador, abra **Gmail RadarVagas**, crie uma chave com pelo menos 24 caracteres e clique em **Salvar**.

### 3. Configurar o Apps Script

Baixe `public/gmail-radarvagas.gs`, cole o conteúdo em um projeto do Google Apps Script e adicione estas propriedades em **Configurações do projeto → Propriedades do script**:

| Propriedade | Valor |
|---|---|
| `RADAR_URL` | `https://radar-carreira-platform.al-ramos.workers.dev` |
| `RADAR_SECRET` | A mesma chave salva no painel Gmail RadarVagas |

Não coloque a chave diretamente no arquivo `.gs`.

Execute `importarRadarVagas` manualmente para testar. Na primeira execução, autorize o acesso ao Gmail e às conexões externas. Se ainda não existir um acionador, execute `instalarColetaDiaria` uma vez.

Mantenha somente o acionador `importarRadarVagas`; acionadores antigos chamados `coletar` devem ser removidos.

O conector atual:

- lê mensagens das últimas 48 horas;
- consulta até 100 tópicos recentes da etiqueta;
- importa alertas compatíveis;
- atualiza candidaturas reconhecidas no pipeline;
- tenta enriquecer vagas do LinkedIn;
- prepara e envia o resumo diário quando houver correspondências suficientes.

## Coleta de fontes públicas

O painel aceita os identificadores públicos de páginas hospedadas em:

- Greenhouse;
- Lever;
- Ashby.

O GitHub Actions executa, em dias úteis:

1. coleta das fontes ativas;
2. enriquecimento das vagas;
3. verificação de vagas possivelmente encerradas.

Configuração do repositório:

| Tipo | Nome | Uso |
|---|---|---|
| Variable | `RADAR_BASE_URL` | URL publicada do portal |
| Secret | `COLLECTOR_SECRET` | Chave compartilhada com o ambiente do Sites |

Uma execução HTTP bem-sucedida pode retornar `sources: 0` quando nenhuma fonte foi cadastrada. O resultado real deve ser conferido pelos campos `sources`, `received`, `inserted`, `updated` e `errors`.

### Resiliência e retomada

A rotina processa uma fonte por chamada e grava vagas no D1 em lotes, reduzindo o risco de exceder o tempo disponível no Worker. Entre fontes há uma pausa curta e falhas transitórias de infraestrutura recebem novas tentativas antes de interromper o fluxo.

Em uma execução manual é possível informar `start_offset` para retomar uma coleta a partir de uma fonte específica, sem repetir as anteriores. Isso é útil quando uma indisponibilidade temporária ocorre durante um ciclo longo. As descrições são normalizadas e limitadas a 12.000 caracteres por vaga antes da gravação, preservando conteúdo suficiente para análise sem sobrecarregar o Worker/D1.

Validação operacional em 13/08/2026: a retomada percorreu as fontes restantes, incluindo Capco (734 vagas), e as etapas de enriquecimento e ciclo de vida foram verificadas. A confirmação de um ciclo integral após uma recuperação de `503` permanece como verificação operacional do próximo ciclo.

## Autenticação e autorização

- contas locais usam PBKDF2-SHA-256 e sessão HMAC em cookie seguro, HTTP-only e com duração de 12 horas;
- em `*.chatgpt.site`, a identidade é recebida por cabeçalhos protegidos;
- o servidor cria o perfil no primeiro acesso quando necessário;
- usuários comuns veem Radar, pipeline, alertas, métricas e preferências;
- recursos administrativos são verificados novamente no servidor por permissões RBAC;
- roles podem chegar diretamente ao usuário ou por grupo;
- o proprietário possui bypass explícito e não pode ser rebaixado;
- chaves de Gmail e extensões são armazenadas somente como hash SHA-256.

## Situação atual

Já implantado:

- portal público e banco D1;
- contas locais, Sign in with ChatGPT, perfis e autorização RBAC;
- vagas persistentes e deduplicação;
- importação JSON/CSV e extensões LinkedIn/APinfo;
- integração Gmail RadarVagas validada;
- conectores Greenhouse, Lever e Ashby;
- score explicável, veredito estratégico e análise personalizada persistida;
- IA opcional com cache, orçamento mensal e preparação para entrevista;
- pipeline, acompanhamento de candidatura, alertas, métricas, monitoramento, auditoria e qualidade;
- backup, relatório e gestão de usuários;
- coleta agendada, enriquecimento e ciclo de vida;
- recuperação de coleta por `start_offset`, tentativas controladas e limite seguro para descrições extensas;
- build, testes de regras, limites de Worker e integração RBAC.

Pontos de atenção confirmados no código atual:

1. aplicar `report.export` à rota de relatório, que hoje exige autenticação, mas não essa permissão RBAC;
2. alinhar a etapa `offer` entre API, métricas e enum principal do pipeline;
3. garantir exclusão referencial de análises e fatos de IA ao remover vagas;
4. concluir a administração de grupos, atribuições de roles e auditoria de acesso;
5. fazer `emailImportEnabled`, `enrichmentEnabled`, `retentionDays` e `defaultMinScore` produzirem efeito integral;
6. unificar a política mínima de senha entre cadastro, convite e bootstrap;
7. eliminar o limite prático de 150 candidatas em filtros que exigem score/veredito;
8. corrigir os loaders da integração RBAC no Windows/Node.js 24;
9. atualizar a documentação da extensão APinfo da versão 1.5.1 para o manifesto 1.6.2;
10. ampliar o backup, que hoje é operacional e não inclui perfis, pipeline, RBAC, análises ou consumo de IA.

Consulte a [visão completa do projeto](docs/visao-completa-do-projeto.md) para o inventário das APIs, todas as regras, limitações e diagramas de arquitetura.

## Desenvolvimento

Antes de enviar uma alteração:

```bash
npm test
```

O projeto reaproveita conceitos do `al-ramos/radar-vagas`, reestruturados para uma aplicação web multiusuário com persistência, automação e administração centralizada.
