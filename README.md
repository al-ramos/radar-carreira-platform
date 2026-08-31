# Radar Carreira Platform

Portal multiusuário para reunir oportunidades, decidir quais vagas merecem atenção e acompanhar candidaturas em um único lugar. O produto combina coleta multicanal, aderência explicável, triagem operacional em filas, revisão por IA ou Codex, preparação segura de rascunhos Gmail e operação administrativa.

**Produção:** [radar-carreira-platform.al-ramos.workers.dev](https://radar-carreira-platform.al-ramos.workers.dev)

**Documentação completa:** [visão do produto, arquitetura, recursos, regras de negócio, dados, APIs, segurança e operação](docs/visao-completa-do-projeto.md)

## Prioridade principal — triagem inteligente e candidatura assistida

> **A prioridade atual do Radar é transformar vagas recebidas em decisões seguras e ações acompanháveis:** triar, revisar, preparar a candidatura e confirmar o envio, mantendo a pessoa no controle.

| Pilar prioritário | Resultado esperado | Estado |
|---|---|:---:|
| **1. Decidir** | aplicar perfil canônico, score, bloqueadores e veredito explicável | ✅ Em produção |
| **2. Revisar** | confirmar o recorte pela IA do portal, pelo Codex ou por CSV, com histórico e origem | ✅ Em produção |
| **3. Candidatar** | criar o rascunho seguro com currículo e assinatura e enviá-lo automaticamente ao contato válido | ✅ Em produção |
| **4. Operar** | acompanhar filas, importações, triagens, falhas, retomadas e envios em um centro operacional | ✅ Em produção |

### Próximos focos desta prioridade

1. concluir a governança RBAC e a auditoria de acesso ponta a ponta;
2. tornar ainda mais visível a precedência entre regras, IA do portal, Codex e CSV;
3. ampliar a operação de filas de mensagens mortas, alertas e notificações para múltiplos operadores;
4. validar continuamente backup, Gmail, LinkedIn e demais integrações críticas.

**Princípio inegociável:** o Radar pode coletar, analisar, priorizar e preparar; a candidatura e o envio do e-mail continuam sendo decisões da pessoa usuária.

> **Sincronização permanente:** toda mudança funcional relevante deve atualizar este README, a [visão completa do projeto](docs/visao-completa-do-projeto.md) e as páginas correspondentes no Notion na mesma entrega.

## Estado publicado — 30 de agosto de 2026

> **Marco funcional:** commit [`7e417c5`](https://github.com/al-ramos/radar-carreira-platform/commit/7e417c52f7c768632a09fa45e8c4d4144d7db901), validado e publicado pelo workflow [`33329470344`](https://github.com/al-ramos/radar-carreira-platform/actions/runs/33329470344). O histórico Git permanece como inventário cronológico; esta seção registra somente o estado consolidado, sem repetir cada commit.

- A triagem abre por padrão nas vagas não analisadas, localiza também vagas arquivadas pelo código e mantém filtros, contadores e seleção no mesmo recorte.
- Atalhos da triagem abrem a vaga correta no Radar, inclusive candidaturas e itens arquivados, sem que respostas antigas de busca sobrescrevam a navegação atual.
- O score fica oculto até a vaga ser triada; tecnologias prioritárias são evidência técnica, mas não substituem modalidade, geografia, senioridade, idioma nem requisitos obrigatórios.
- A aprovação automática respeita a região cadastrada e a pessoa proprietária pode desclassificar manualmente uma vaga, preservando o histórico e cancelando somente rascunhos ainda pendentes.
- Toda aprovação `✅` com e-mail válido pode criar rascunho imediatamente. A recuperação agendada cobre pendências, decisões antigas, aprovações sem histórico e aprovações sem registro na outbox.
- O Radar registra a abertura de candidatura no LinkedIn. Na manutenção, a pessoa proprietária vê a contagem exata por situação, pode arquivar suas vagas vistas, arquivar globalmente qualquer quantidade do acervo ativo e excluir qualquer quantidade de vagas inativas, sempre com data, alcance, ordenação pelas mais antigas e impacto explícitos.
- O Monitoramento mede uma amostra anônima de desempenho, mostra p75/p95 em 24 horas e 7 dias e remove as amostras após 30 dias; os planos D1 críticos são auditáveis por comando reproduzível.
- Nenhuma dessas automações envia candidatura ou e-mail: a ação final continua sob controle da pessoa usuária.

Trabalho concorrente deve usar publicação isolada e preservar alterações locais não relacionadas. Clones ou worktrees exclusivos de uma entrega só são removidos após confirmação da publicação e quando estiverem limpos.

> O portal está público, mas o visitante precisa entrar (e-mail/senha ou, quando hospedado em `*.chatgpt.site`, Sign in with ChatGPT) para acessar as áreas identificadas.

## O que o portal faz

- reúne vagas recebidas por Gmail, integração LinkedIn, entradas APInfo, importação JSON/CSV e páginas públicas de carreiras;
- evita duplicações por `fingerprint` e identificador externo;
- exibe vagas paginadas das últimas 24 horas, 3 dias, 7 dias ou de todo o histórico;
- calcula um score explicável considerando competências, áreas, senioridade, modalidade, localização, atualidade e termos a evitar;
- aplica um veredito estratégico em quatro fases, com bloqueadores de idioma, senioridade, atuação e geografia, além de evidências e ressalvas de stack;
- oferece aprofundamento opcional por IA, com fatos verificáveis, cache, orçamento mensal e preparação para entrevista;
- mostra a descrição dentro do Radar, infere tecnologias e mantém separadas a URL estável e a URL de candidatura;
- permite copiar e compartilhar a descrição, exportar resultados e gerar uma mensagem de candidatura segura;
- mantém um pipeline individual com notas, etapas e marcos de mensagem gerada, enviada e respondida;
- bloqueia uma nova abertura de candidatura quando o acompanhamento já registra envio ou resposta;
- executa triagem manual ou agendada por fonte e período, com histórico, idempotência, filas resilientes, tentativas e retomada;
- após uma importação push do LinkedIn ou APInfo, percorre todo o lote em continuações de 10 vagas, usando IA apenas nas ambiguidades da primeira rodada;
- permite revisar um recorte no portal, preparar até 50 vagas para o Codex ou reimportar vereditos externos por CSV;
- permite desclassificar manualmente uma vaga já avaliada, com decisão aditiva no histórico e cancelamento de rascunho ainda pendente;
- cria e envia candidaturas elegíveis no Gmail, com currículo, assinatura e confirmação persistida pela outbox;
- reconhece confirmações de candidatura recebidas do LinkedIn pelo Gmail, marca o acompanhamento como enviado e notifica somente na primeira transição;
- registra notificações de importação, triagem e candidatura, com acesso direto aos relatórios operacionais;
- centraliza importações, lotes de triagem e a agenda das automações no monitoramento, com heartbeats persistidos, alertas acionáveis, falhas, último sucesso e filtros por fluxo;
- mede desempenho operacional anônimo (Web Vitals, lista de vagas e filtros), com p75/p95, retenção de 30 dias e auditoria dos índices D1;
- envia um resumo diário por Gmail quando existem oportunidades acima do score mínimo;
- registra análises elegíveis, importações, as vagas e causas de aceite/rejeição de cada lote, eventos, consumo de IA, qualidade dos dados e ciclo de vida das vagas.

## Recursos disponíveis

### Para usuários

- Radar com busca por código ou texto, paginação e filtros de período, fonte exata, área profissional, canal de entrada, importação específica, pipeline, veredito e score; a triagem inicia no recorte não analisado e encontra vagas arquivadas pelo código;
- perfil profissional com competências, áreas, modalidades, senioridades e regras estratégicas de carreira;
- detalhe da vaga, tecnologias inferidas, score explicado e veredito em quatro fases;
- análise personalizada persistida somente para vagas elegíveis;
- aprofundamento opcional por IA e briefing de entrevista;
- acesso ao anúncio original, URL de candidatura e contato APinfo quando disponível;
- pipeline Kanban com notas e acompanhamento da candidatura;
- alertas e resumo diário;
- métricas pessoais de funil, conversão, empresas e tecnologias;
- exportação CSV compatível com Excel;
- central de triagem com seleção em lote, filtros, progresso, histórico, logs, saúde operacional e ações por vaga;
- análise consultiva assíncrona pela IA do portal e fila privada para análise no Codex;
- preparação de rascunhos Gmail, recuperação de aprovações legadas, reprocessamento de falhas e confirmação manual ou reconciliação do envio;
- abertura da vaga no Radar e desclassificação manual diretamente pela central de triagem.
- reutilização em lote de contatos já cadastrados por empresa, disponível junto aos filtros de e-mail.

### Para administradores

- importação manual em JSON ou CSV;
- modelo CSV para download;
- cadastro e ativação de fontes Greenhouse, Lever e Ashby;
- coleta manual e agendada;
- integração Gmail `RadarVagas`;
- chaves protegidas para integrações push LinkedIn e APInfo;
- configurações e parâmetros operacionais;
- monitoramento de coletas, agendas e última execução das automações;
- auditoria e qualidade dos dados;
- gestão de usuários, roles e permissões granulares;
- backup administrativo;
- relatório compatível com Excel;
- criação imediata de rascunho no Gmail para toda aprovação segura com e-mail válido;
- notificações operacionais com acesso ao relatório completo de importações e lotes de triagem.

### Importar currículo em PDF

Em **Preferências do Radar**, use **Importar currículo em PDF** para gerar uma proposta de competências. O PDF é lido em memória, não é armazenado pelo Radar, e contatos como e-mail, telefone e CPF são removidos antes da leitura opcional por IA. A pessoa revisa cada tecnologia e escolhe separadamente qualquer sugestão para a **stack principal obrigatória**; nada é salvo até clicar em **Adicionar ao formulário** e, depois, em **Salvar preferências**. Nesta primeira versão, o arquivo precisa ter texto selecionável, até 10 MB e 30 páginas; PDFs escaneados aguardam a etapa de OCR.

## Como o Radar decide

O produto usa mecanismos complementares, cada um com uma finalidade:

| Mecanismo | Resultado | Finalidade |
|---|---|---|
| Score numérico | `0` a `100` | ordenar e filtrar oportunidades por aderência |
| Veredito estratégico | `✅`, `🟡`, `🔴` ou `❌` | aplicar preferências e bloqueadores pessoais em quatro fases |
| IA opcional | fatos, evidências, ambiguidades e perguntas | aprofundar o contexto e, quando confirmado, registrar um novo veredito oficial |

Vagas fora do escopo de TI continuam visíveis, mas não recebem aderência. O perfil salvo no D1 é a única fonte de verdade da triagem; sem competências dominadas não há veredito. Análises do portal, do Codex ou importadas por CSV podem substituir explicitamente o veredito. Para entrar na fila de rascunho, a decisão oficial precisa ser `✅` e a vaga precisa ter contato válido; no LinkedIn, o e-mail explícito também é obrigatório. O estado da candidatura não regride: **mensagem gerada → enviada → respondida**.

Em **Configurações → Meu perfil**, a pessoa pode ampliar o recorte sem declarar experiência inexistente: aceitar presencial nas regiões escolhidas, qualquer frequência híbrida, contrato não informado e tecnologias explicitamente marcadas na vaga como diferenciais. Requisitos obrigatórios continuam exigindo evidência no perfil. Idiomas avançados só deixam de bloquear quando estiverem marcados como aceitos para comunicação diária.

As coletas importam todas as vagas válidas, sem filtro de stack. C#, .NET, SQL/PLSQL, VB6/Visual Basic, VBA, Office e Excel são reconhecidas como tecnologias prioritárias quando aparecem como requisito ou diferencial. Essa evidência reforça o fit técnico, mas não concede aprovação sozinha: modalidade, geografia, senioridade, idioma, contratação e requisitos obrigatórios continuam sendo avaliados. Stack fora do foco principal pede revisão, sem virar bloqueio estrutural por si só; menções a idioma sem exigência explícita também não bloqueiam.

## Fluxo dos dados

```text
Gmail/RadarVagas ─────┐
LinkedIn/APInfo push ──┼─> normalização e deduplicação ─> Cloudflare D1 ─> Radar e pipeline
JSON ou CSV ──────────┤                                  │
ATS públicos ─────────┘                                  ├─> score e triagem em filas
                                                         ├─> IA do portal ou Codex
                                                         └─> rascunhos, notificações e resumo diário
```

As senhas do Gmail não são armazenadas. O conector do Google Apps Script envia apenas mensagens recentes da etiqueta `RadarVagas`, usando uma chave exclusiva cujo hash fica registrado no banco.

### Currículo e assinatura nos rascunhos

Todo rascunho de candidatura recebe o currículo PDF e a assinatura padrão da AMR Solution. Antes de atualizar o `gmail-radarvagas.gs`, envie o currículo ao Google Drive da mesma conta que executa o Apps Script e configure a propriedade do script `RADAR_CV_FILE_ID` com o ID do arquivo — a parte entre `/d/` e a próxima `/` no link do Drive. O arquivo permanece privado no Drive; não deve ser compartilhado publicamente nem enviado ao banco do Radar. Sem essa propriedade, a criação do rascunho falha de forma explícita para nunca preparar uma candidatura sem o currículo.

## Stack

- Next.js 16 e React 19;
- TypeScript;
- vinext, Vite e Cloudflare Workers;
- Drizzle ORM e Cloudflare D1;
- Tailwind CSS e identidade visual em Geist;
- autenticação local e, em domínios `*.chatgpt.site`, Sign in with ChatGPT;
- provedor opcional compatível com OpenAI Chat Completions;
- Cloudflare Queues para triagem e análises assíncronas, com filas de mensagens mortas;
- MCP privado do Radar para a fila de revisão pelo Codex;
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
npm run audit:d1
```

`npm test` executa o build e a suíte regular, atualmente com **216 testes**, que combina regras de negócio com verificações estruturais do código. `npm run test:rbac-integration` executa **26 testes** chamando `can()` de `lib/rbac.ts` contra SQLite real em memória (`node:sqlite`), populado com as migrations `0010`/`0011`, usando loaders que simulam `cloudflare:workers` e o binding D1. A esteira executa as duas suítes; o ambiente oficial continua usando Node.js 22 e os loaders também são compatíveis com Node.js 24 no Windows.

`npm run audit:d1` executa somente `EXPLAIN QUERY PLAN` contra o D1 remoto e falha se os índices esperados não forem usados. Consulte [desempenho e observabilidade](docs/performance-observability.md) para as métricas coletadas, limites de privacidade, p75/p95, retenção e índices cobertos.

Validação do escopo em 30/08/2026: **216 testes regulares + 26 testes de integração RBAC passando**; build concluído e lint sem erros, com 11 avisos preexistentes.

## Banco de dados

O projeto usa Cloudflare D1. O schema principal está em `db/schema.ts` e as migrações estão em `drizzle/`.

Principais grupos de tabelas:

- carreira e acesso: `profiles` e `local_accounts`;
- vagas e operação: `job_sources`, `jobs`, `company_contacts`, `job_events`, `import_runs` e `job_import_runs`;
- acompanhamento: `user_job_status` e `user_job_analyses`;
- triagem: `triage_batches`, `triage_history`, `triage_batch_items`, `triage_deduplication`, `triage_ai_reviews`, `triage_ai_review_chunks` e `job_ai_triage`;
- candidatura assistida: `draft_outbox`;
- inteligência e telemetria: `job_ai_facts`, `ai_usage_events` e `performance_samples`;
- alertas: `alert_preferences`, `alert_reads` e `alert_deliveries`;
- administração: `platform_settings` e `notifications`;
- RBAC: `roles`, `permissions`, `role_permissions`, `groups`, `group_roles`, `user_roles`, `user_groups` e `access_audit_log`.

O schema possui **35 tabelas**. Preferências, snapshots e resultados estruturados são armazenados como JSON textual quando apropriado para D1/SQLite. As chaves compostas e o `userId` isolam pipeline, análise, triagem e leitura por pessoa; leases, chaves de idempotência, heartbeats, outbox e telemetria com retenção tornam observáveis os fluxos assíncronos.

Cada projeto publicado no Sites possui seu próprio banco D1. Publicar o mesmo código em um novo endereço não transfere automaticamente vagas, perfis, fontes ou configurações do banco anterior.

## Publicação contínua no Cloudflare

O GitHub Actions valida cada pull request e cada push na `main`. Depois de uma validação bem-sucedida na `main`, a esteira aplica migrations pendentes no D1 e publica o Worker no Cloudflare.

Antes do primeiro push com deploy, crie estes **Repository secrets** em `Settings` → `Secrets and variables` → `Actions` no GitHub:

- `CLOUDFLARE_API_TOKEN`: token da Cloudflare com permissão de edição para Workers e D1 na conta do projeto;
- `CLOUDFLARE_ACCOUNT_ID`: identificador da conta Cloudflare onde estão o Worker e o banco `radar-carreira-db`.

As credenciais não devem ser adicionadas a arquivos do repositório ou ao código-fonte. O binding `DB`, o ID do D1 e as migrations ficam em `wrangler.jsonc` e `drizzle/`.

Para ativar o aprofundamento opcional com IA, configure diretamente no ambiente do Worker `OPENAI_API_KEY` e `OPENAI_MODEL`. Alternativamente, `AI_API_KEY`, `AI_MODEL` e `AI_PROVIDER` permitem um provedor compatível com Chat Completions; `OPENAI_BASE_URL` ou `AI_BASE_URL` define um endpoint diferente. As regras determinísticas continuam funcionando sem essas variáveis. Cada perfil define seu limite mensal de tokens; resultados factuais são armazenados em cache por versão da descrição da vaga, e o uso devolvido pelo provedor é contabilizado no servidor.

## Triagem inteligente e candidatura assistida

A central de triagem transforma um recorte da Home em um lote rastreável. O recorte pode combinar fonte, período, área, canal e vagas já analisadas; a execução manual entra em Cloudflare Queue e cada vaga mantém estado, número de tentativas, lease, erro e histórico. Lotes interrompidos podem ser retomados, e a chave de idempotência inclui usuário, vaga e versões do perfil, das regras e das instruções.

O fluxo de decisão possui quatro caminhos:

1. **Regras determinísticas:** classificação `✅`, `🟡`, `🔴` ou `❌` usando somente o perfil canônico salvo no Radar.
2. **IA no portal:** consulta assíncrona, dividida em partes e consolidada em segundo plano; o consumo entra no orçamento mensal.
3. **Codex:** o portal congela o perfil e o pedido em uma fila privada, acessível pelo MCP do Radar. Seleções maiores são enviadas automaticamente em lotes sequenciais de até 50 vagas, respeitando o teto técnico de cada registro.
4. **CSV externo:** a administração pode reimportar até 2.000 vereditos por código externo. No histórico, as vagas selecionadas também podem ser baixadas em CSV com código, título, status atual e descrição do status.

Quando a pessoa confirma um resultado da IA, do Codex ou do CSV, ele vira o veredito oficial e entra na mesma trilha de histórico. Para liberar um rascunho, o servidor exige `✅` e contato válido. No LinkedIn, o e-mail explícito também é obrigatório; `🟡` permanece para revisão humana.

### Automação e segurança

- importações push do LinkedIn ou APInfo podem iniciar a triagem logo após a persistência do lote;
- lotes grandes continuam pela fila, em blocos de 10 e sem teto fixo de continuações, até que todas as vagas ainda não analisadas sejam processadas, sem alongar a requisição de importação;
- três interruptores administrativos controlam separadamente a triagem agendada, a entrada na outbox e a criação real do rascunho no Gmail;
- a automação agendada aceita somente vagas `✅` para rascunho;
- o Apps Script cria o rascunho, confirma sua vinculação à vaga, envia automaticamente e registra a mensagem comprovada pelo Gmail;
- criação, falha e envio ficam registrados em `draft_outbox`; cada rascunho e cada mensagem do Gmail só podem pertencer a uma vaga, e a interface distingue confirmação pelo Gmail de informação manual;
- notificações no sino abrem o log completo do lote ou da importação correspondente.

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

### Rascunhos de candidatura

O Radar cria imediatamente o rascunho de toda vaga aprovada (✅) com e-mail de contato válido, anexa o currículo, inclui a assinatura e o envia automaticamente, independentemente de a aprovação ter vindo da triagem agendada, IA, Codex ou CSV. A outbox registra primeiro o rascunho e depois a mensagem enviada, impedindo repetição da mesma candidatura. Se o conector imediato estiver indisponível, a vaga fica marcada como falha com o motivo visível e o botão **Tentar novamente** aciona o Gmail de novo após a correção.

Depois de salvar e publicar uma nova versão do Apps Script, execute **uma vez** `instalarAutomacaoRascunhosRadar`. Ela instala uma recuperação a cada cinco minutos: consulta os itens que o Radar já confirmou, retoma falhas transitórias e envia as novas candidaturas elegíveis que ainda não chegaram ao estado `sent`. A chamada imediata continua sendo o caminho normal.

Para atualizar automaticamente os envios manuais, execute `instalarVerificacaoEnviosRadar` **uma única vez** no Apps Script depois de salvar a versão atual do arquivo. Ela instala um gatilho a cada 15 minutos que consulta somente a pasta **Enviados** e marca no Radar os rascunhos comprovadamente enviados. A rotina não cria rascunhos e não envia e-mails. Para desligá-la, execute `removerVerificacaoEnviosRadar`.

A tela permite reprocessar falhas, consultar a pasta Enviados e confirmar explicitamente um envio que o Gmail não localizou. Essas ações atualizam somente o acompanhamento; nunca disparam uma mensagem.

## Coleta de fontes públicas

O painel aceita os identificadores públicos de páginas hospedadas em:

- Greenhouse;
- Lever;
- Ashby.

O GitHub Actions executa, em dias úteis:

1. coleta das fontes ativas;
2. enfileiramento da triagem para cada fonte concluída, incluindo vagas pendentes de ciclos anteriores;
3. enriquecimento das vagas;
4. verificação de vagas possivelmente encerradas.

Se uma fonte exceder temporariamente o limite do Worker (`503`/`1102`), a rotina continua pelas demais fontes e conclui as etapas posteriores. A execução fica marcada com falha para investigação, e a fonte afetada é tentada novamente na próxima agenda ou a partir do seu `start_offset`.

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
- importação JSON/CSV, integração LinkedIn e entrada push APInfo;
- integração Gmail RadarVagas validada;
- conectores Greenhouse, Lever e Ashby;
- score explicável, veredito estratégico e análise personalizada persistida;
- IA opcional com cache, orçamento mensal e preparação para entrevista;
- pipeline, acompanhamento de candidatura, alertas, métricas, monitoramento, auditoria e qualidade;
- backup, relatório e gestão de usuários;
- coleta agendada, enriquecimento e ciclo de vida;
- recuperação de coleta por `start_offset`, tentativas controladas e limite seguro para descrições extensas;
- triagem manual e pós-importação em Cloudflare Queue, com idempotência, leases, retomada e histórico por vaga;
- revisão assíncrona pela IA do portal, fila privada do Codex e reimportação de vereditos por CSV;
- veredito de IA aplicável como decisão oficial, com origem e histórico preservados antes de qualquer rascunho;
- outbox de rascunhos Gmail, criação imediata ou controlada por interruptores, reprocessamento e reconciliação de envios;
- notificações operacionais de importação, triagem e candidatura, com acesso direto aos logs;
- filtros e seleção em lote na Home e na triagem, exportação somente das vagas selecionadas e reutilização de contato por empresa;
- build, testes de regras, limites de Worker e integração RBAC.

Pontos de atenção confirmados no código atual:

1. concluir a administração de grupos, atribuições de roles e auditoria de acesso;
2. definir explicitamente a política de contabilização quando outro usuário reutiliza fatos de IA já armazenados em cache;
3. ampliar o diagnóstico de saúde além do banco D1, incluindo integrações e configurações essenciais;
4. bloquear coletas gerais concorrentes e alertar administradores após falhas consecutivas;
5. processar também a coleta manual de ATS em lotes;
6. concluir a validação operacional manual da extensão LinkedIn 2.2.0 e registrar aceitas, rejeitadas, novas e atualizadas;
7. remover ou atualizar referências restantes ao coletor APInfo legado, cujo código foi retirado do repositório em 23/08/2026;
8. consolidar a política de precedência entre veredito determinístico, IA do portal, Codex e CSV em uma única tela de auditoria;
9. ampliar notificações e trilhas de acesso para cenários com múltiplos operadores, pois o fluxo atual de notificações é restrito à proprietária.

Concluídos neste ciclo: permissão `report.export`, etapa `offer`, limpeza referencial de IA, efeito das configurações operacionais, política mínima de 8 caracteres para novas senhas, filtros sem teto fixo de 150 candidatas, loaders RBAC no Windows/Node.js 24, documentação APinfo 1.6.2, backup funcional/RBAC ampliado e execução das duas suítes na esteira.

Consulte a [visão completa do projeto](docs/visao-completa-do-projeto.md) para o inventário das APIs, todas as regras, limitações e diagramas de arquitetura.

## Desenvolvimento

Antes de enviar uma alteração:

```bash
npm test
```

O projeto reaproveita conceitos do `al-ramos/radar-vagas`, reestruturados para uma aplicação web multiusuário com persistência, automação e administração centralizada.
