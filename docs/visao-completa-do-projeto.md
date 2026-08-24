# Radar Carreira Platform — visão completa do produto e da arquitetura

> Documento de conhecimento do estado real do repositório em **24 de agosto de 2026**, cobrindo as funcionalidades publicadas até o commit `7d0ece2` (`Registra saúde das automações`).

## Como ler este documento

Este material descreve o que está implementado no código, não apenas o que aparece na interface. Ele reúne produto, regras de negócio, dados, segurança, integrações, operação, testes, limitações e pontos de atenção. Quando uma estrutura existe, mas ainda não forma um fluxo completo, isso é indicado explicitamente.

## 1. Resumo executivo

O Radar Carreira é uma plataforma web multiusuário para centralizar oportunidades, decidir quais vagas merecem atenção e acompanhar o processo seletivo. O produto combina cinco capacidades principais:

1. **Aquisição:** recebe vagas de ATS públicos, integração LinkedIn, entradas push APInfo, Gmail e arquivos JSON/CSV.
2. **Qualificação:** normaliza, deduplica, infere tecnologias, calcula aderência e aplica bloqueadores pessoais.
3. **Triagem e revisão:** processa lotes em filas, preserva histórico e permite revisão pela IA do portal, pelo Codex ou por CSV externo.
4. **Candidatura assistida:** valida contato e elegibilidade, prepara rascunhos Gmail, reconcilia envios e atualiza o acompanhamento sem enviar e-mail automaticamente.
5. **Operação:** mantém pipeline pessoal, notificações, alertas, métricas, RBAC, auditoria, qualidade, backup, coleta agendada e publicação contínua.

O sistema é executado como um Cloudflare Worker, com interface Next.js/React compilada por vinext/Vite e persistência em Cloudflare D1 via Drizzle ORM.

### Estado funcional em uma frase

O fluxo central — entrar, cadastrar perfil, descobrir vaga, triar em lote, revisar a decisão, preparar um rascunho e acompanhar a candidatura — está implementado. A governança RBAC avançada, a ampliação das notificações para múltiplos operadores e algumas validações operacionais permanecem como pontos de atenção descritos na seção 15.

### Prioridade principal do produto

A prioridade atual é consolidar o ciclo **triagem inteligente → revisão → rascunho seguro → acompanhamento do envio**. Isso significa:

1. preservar decisões determinísticas explicáveis e versionadas;
2. permitir revisão por IA, Codex ou CSV sem perder origem e histórico;
3. gerar somente rascunhos aprovados, revalidados e com contato válido;
4. tornar filas, importações, triagens, falhas, retomadas e envios visíveis em um centro operacional;
5. manter a candidatura e o envio sob decisão da pessoa usuária.

Esta prioridade deve permanecer sincronizada entre o README principal, este inventário técnico e o hub do projeto no Notion em toda entrega funcional relevante.

## 2. Arquitetura em alto nível

```mermaid
flowchart LR
    subgraph Entrada["Aquisição de vagas"]
        ATS["Greenhouse · Lever · Ashby"]
        EXT["LinkedIn · APInfo push"]
        GMAIL["Gmail · etiqueta RadarVagas"]
        FILE["JSON · CSV"]
    end

    ATS --> NORM["Normalização · validação · deduplicação"]
    EXT --> NORM
    GMAIL --> NORM
    FILE --> NORM
    NORM --> D1["Cloudflare D1"]
    D1 --> RADAR["Radar · busca · filtros · detalhe"]
    D1 --> DECISAO["Score · veredito · análise personalizada"]
    DECISAO --> FILA["Cloudflare Queues · lotes · histórico"]
    FILA --> IA["IA do portal · Codex · CSV"]
    IA --> OUTBOX["Outbox · rascunhos Gmail · reconciliação"]
    OUTBOX --> PIPE["Pipeline · candidatura · notificações"]
    D1 --> OPS["Fontes · qualidade · monitoramento · auditoria"]
    GHA["GitHub Actions"] --> ATS
    GHA --> DEPLOY["Migrations D1 · deploy do Worker"]
```

### Fronteiras do sistema

- **Navegador:** React, experiência do Radar e extensões locais.
- **Servidor:** rotas App Router e regras sensíveis executadas no Worker.
- **Persistência:** um banco D1 identificado pelo binding `DB`.
- **Automação:** GitHub Actions chama endpoints protegidos e publica a aplicação; Cloudflare Queues processa triagem e revisão assíncrona.
- **Serviços externos:** APIs públicas dos ATS, Gmail via Apps Script, provedor compatível com OpenAI Chat Completions e MCP privado para o Codex.

## 3. Stack e ferramentas

| Camada | Tecnologia | Papel no projeto |
|---|---|---|
| Aplicação | Next.js 16.2.6 | App Router, páginas, rotas HTTP e renderização |
| Interface | React 19.2.6 + React DOM | Dashboard e modais funcionais |
| Linguagem | TypeScript 5.9.3 | Aplicação, domínio e infraestrutura |
| Runtime de build | vinext 0.0.50 + Vite 8.0.13 | Compilação do Next.js para Cloudflare |
| Hospedagem | Cloudflare Workers | Runtime de produção e entrega de assets |
| Imagens | Cloudflare Images binding | Otimização pelo endpoint do vinext |
| Banco | Cloudflare D1 / SQLite | Dados do produto e operação |
| ORM | Drizzle ORM 0.45.2 | Schema tipado e consultas |
| Migrations | Drizzle Kit / SQL | Evolução do banco; arquivos versionados de `0000` a `0033` |
| Estilos | CSS próprio + Tailwind/PostCSS 4 | Identidade visual e layout |
| Fonte | Geist | Tipografia do produto |
| Automação | GitHub Actions | validação, coleta, revalidação e deploy |
| Integração Gmail | Google Apps Script | leitura da etiqueta e envio do resumo diário |
| Integração de navegador | Chrome Manifest V3 | extensão LinkedIn externa; o coletor APInfo legado foi removido deste repositório |
| Filas | Cloudflare Queues + DLQ | triagem e consultas assíncronas à IA, com tentativas controladas |
| Assistente | MCP privado do Radar | entrega snapshots de triagem ao Codex sem expor SQL ou ações irrestritas |
| Testes | Node.js test runner | testes estruturais, de regras e integração RBAC |
| Runtime mínimo | Node.js 22.13 | desenvolvimento, build e testes |

## 4. Experiência e módulos visíveis

O dashboard organiza os módulos abaixo:

| Módulo | Público-alvo | O que entrega |
|---|---|---|
| Radar | Usuário | lista paginada, busca, filtros, ordenação, score, detalhe e ações |
| Pipeline | Usuário | acompanhamento individual, etapa, nota e candidatura |
| Alertas | Usuário | oportunidades dos últimos 7 dias, leitura e preferências |
| Métricas | Usuário | funil, conversão, empresas e tecnologias |
| Triagem IA | Usuário/owner | lotes, filtros, fila, histórico, IA, Codex, CSV e rascunhos |
| Notificações | Operação/owner | eventos de importação, triagem e candidatura com links para relatórios |
| Monitoramento | Operação | centro operacional com banco, fontes, agenda e heartbeats das automações, importações, triagens, alertas acionáveis, falhas e último sucesso |
| Auditoria | Operação | linha do tempo de importações e eventos de vagas |
| Qualidade | Operação | completude dos dados e enriquecimento |
| Usuários | Administração | contas locais, perfis, convites e papel básico |
| Extensão LinkedIn | Administração | chave exclusiva e instruções de conexão |
| Integração APInfo | Administração | chave push e dados recebidos; o coletor local legado não integra mais este repositório |
| Gmail RadarVagas | Administração | chave do Apps Script e integração de e-mail |
| Fontes | Operação | catálogo, cadastro, teste, ativação e coleta de ATS |
| Importações | Operação | envio manual de JSON ou CSV |
| Configurações | Administração | chaves operacionais, períodos, retenção e manutenção da base |

### Radar de vagas

- Busca por código externo, título, empresa, localização, senioridade e stack.
- Períodos: 24 horas, 3 dias, 7 dias ou todo o histórico.
- Fontes: todas, LinkedIn, APinfo ou demais fontes.
- Pipeline: todas, não vistas, vistas, salvas, candidaturas, entrevistas e rejeitadas.
- Veredito: todos, `✅`, `🟡`, `🔴` ou `❌`.
- Aderência mínima numérica, inclusive o mínimo definido no perfil.
- Ordenação por aderência/publicação ou por importação.
- Paginação no banco, com proteção de período mínimo quando score ou veredito exigem cálculo mais amplo.
- Modo degradado: em falha da personalização, tenta novamente e carrega uma resposta enxuta sem dados demonstrativos.
- Estado de filtros, vaga selecionada e rolagem preservados na sessão do navegador.
- Descrição carregada sob demanda, higienizada e organizada em blocos.
- Ações de copiar descrição, compartilhar, abrir anúncio original e exportar resultado.

### Detalhe e candidatura

- Identifica LinkedIn, APinfo, Greenhouse, Lever, Ashby, Gupy e Quickin pela URL para nomear a ação.
- Mantém `url` estável separada de `applyUrl`, que pode conter token temporário de candidatura.
- Em vagas APinfo, pode abrir a busca pelo código usando o formulário POST exigido pelo site.
- Contatos podem ser salvos com validação, corrigidos quando o domínio veio truncado e reutilizados individualmente em outras vagas da mesma empresa.
- A mensagem de candidatura usa somente competências confirmadas, pode explicitar lacunas e nunca envia e-mail automaticamente.
- Acompanhamento da candidatura distingue `generated`, `sent` e `responded`, com data própria para cada marco.

### Central de triagem

- O recorte combina fonte, período de 24/72/168 horas ou histórico completo, área, canal de entrada e inclusão opcional de vagas já analisadas.
- A triagem manual cria um lote e publica cada vaga na Cloudflare Queue; o histórico exibe `queued`, `processing`, `completed`, `failed` ou `skipped`, tentativas, erro e lease.
- Uma importação push agenda continuações de 10 vagas, sem teto fixo de continuações, até processar todo o lote; a primeira rodada pode usar IA para ambiguidades e as seguintes avançam deterministicamente sobre as vagas ainda sem análise.
- Uma execução interrompida pode ser sincronizada e retomada sem recriar decisões já concluídas.
- A idempotência considera usuário, vaga e revisões do perfil, das regras e das instruções.
- O painel permite selecionar as vagas visíveis ou todas as filtradas, abrir a vaga no Radar, preparar rascunho, consultar IA, preparar para o Codex e conferir envio.
- O sino de notificações abre diretamente o lote e seu log completo.
- Se a reconciliação não localizar o envio no Gmail, a interface permite confirmação explícita da pessoa antes de atualizar somente o acompanhamento.

### Revisão por IA, Codex e CSV

- **IA do portal:** consulta consultiva em fila, dividida em chunks, com consolidação, contabilidade de tokens, status e falhas parciais.
- **Codex:** snapshot persistido do perfil, prompt, filtros e até 50 vagas; o MCP privado permite listar, reivindicar e concluir somente itens autorizados.
- **CSV externo:** reimporta até 2.000 linhas/2 MB por código externo, informa ausentes e ambiguidades e substitui explicitamente o veredito.
- Um veredito confirmado pela IA, Codex ou CSV vira a análise oficial com `source = ai` e nova entrada aditiva no histórico.
- `✅` e `🟡` só liberam rascunho se a revalidação determinística atual continuar segura e houver contato válido; `🔴` e `❌` nunca enfileiram rascunho.

### Rascunhos Gmail

- A outbox persiste `pending`, `drafted`, `sent`, `failed` ou `cancelled`, IDs do Gmail, assunto, erro e datas.
- Índices únicos impedem que o mesmo rascunho ou a mesma mensagem enviada do Gmail sejam associados a duas vagas; a migration 0035 saneia duplicidades legadas antes de aplicar a restrição.
- O histórico diferencia um envio comprovado pelo Gmail de uma confirmação informada manualmente pela pessoa usuária.
- A pessoa pode preparar uma vaga ou seleção, reprocessar falhas, solicitar reconciliação da pasta Enviados ou confirmar o envio manualmente.
- Para LinkedIn, o caminho por e-mail exige `✅` e contato explícito válido.
- Três interruptores independentes controlam triagem agendada, entrada automática na outbox e criação real do rascunho. Na configuração atual, qualquer origem de aprovação `✅` pode preparar e criar o rascunho; `🟡` permanece para revisão humana.
- O Apps Script cria rascunhos e reconhece o envio feito pela pessoa; nenhuma rota ou automação envia a candidatura.
- Um gatilho opcional a cada 15 minutos consulta somente a pasta Enviados e reconcilia rascunhos comprovadamente usados.

## 5. Perfil profissional

Cada usuário possui preferências próprias:

- senioridades aceitas;
- modalidades preferidas;
- competências dominadas;
- áreas desejadas;
- termos a evitar;
- score mínimo;
- regras estratégicas de carreira.

As regras estratégicas incluem nome e título profissional, resumo, localização-base, regiões aceitas, máximo de dias híbridos, contratos preferidos, idiomas de comunicação, senioridades e tipos de atuação bloqueados, stack principal, exceções técnicas, projeto-âncora, política de transparência sobre lacunas e limite mensal de tokens de IA.

Listas legadas separadas por vírgula continuam aceitas, mas são persistidas como JSON. Entradas são normalizadas e limitadas antes da gravação.

## 6. Motor de decisão

O produto possui três mecanismos complementares; eles não devem ser confundidos.

### 6.1 Score numérico (0 a 100)

O score serve para ordenar e filtrar:

| Critério | Efeito |
|---|---:|
| Vaga reconhecida como TI | +5 |
| Competências dominadas encontradas | até +60, proporcionalmente |
| Área desejada | +15 |
| Senioridade compatível | +10 |
| Senioridade divergente explícita no título | -10 |
| Modalidade preferida | +10 |
| Presencial/híbrido fora da área aceita | -20 a -25 |
| Divergência leve de modalidade | -5 a -10 |
| Publicada nas últimas 24 horas | +5 |
| Termo bloqueado | score 0 |
| Vaga fora de TI | score 0 e sem aderência |

Detalhes importantes:

- A correspondência de skills respeita limites de palavra; `R` não casa com `React` e `Go` não casa dentro de outra palavra.
- Se a pessoa escolheu senioridades, vaga sem senioridade declarada não é considerada compatível nesse filtro.
- Para presencial/híbrido, o motor reconhece São Paulo, Mogi das Cruzes, Grande São Paulo e ABC como áreas aceitas no algoritmo numérico atual.
- Vagas fora de TI permanecem visíveis por transparência, mas não recebem veredito.

### 6.2 Veredito estratégico

O veredito avalia a vaga em fases e retorna:

- `✅ Bate`;
- `🟡 Provável com ressalvas`;
- `🔴 Não bate`;
- `❌ Bloqueador estrutural`.

Ordem dos bloqueadores da fase 1:

1. stack incompatível;
2. idioma obrigatório não aceito;
3. senioridade incompatível;
4. tipo de atuação bloqueado;
5. geografia ou frequência híbrida fora da regra.

Somente após esses vetos o motor avalia contratação, fit técnico, tipo de empresa/intermediário e ressalvas. Equivalências conservadoras são aceitas (`GCP`/Google Cloud, `.NET`/C#, `Postgres`/PostgreSQL etc.). Há exceções configuráveis e duas exceções embutidas: `VBA + Access + SQL Server` e `QA .NET Sênior`.

### 6.3 Análise por IA

A IA é opcional e não substitui as regras determinísticas. Quando configurada:

- extrai somente fatos apoiados na descrição;
- estrutura contrato, idioma, tipo de empresa, domínio, cultura, ambiguidades, evidências e perguntas de entrevista;
- limita e valida a estrutura retornada;
- usa cache global por vaga, hash da descrição e versão do analisador;
- contabiliza tokens por usuário e mês;
- bloqueia a chamada antes do provedor se a estimativa exceder o orçamento;
- registra sucesso, falha ou bloqueio de orçamento;
- monta um briefing de entrevista com lacunas e projeto-âncora.

Configuração aceita: `OPENAI_API_KEY`/`OPENAI_MODEL` ou `AI_API_KEY`/`AI_MODEL`/`AI_PROVIDER`, com `OPENAI_BASE_URL` ou `AI_BASE_URL` para endpoint compatível.

## 7. Regras de acompanhamento

- Uma vaga só pode entrar no pipeline ou ter análise persistida se o veredito for `✅` ou `🟡`.
- O usuário precisa ter perfil e competências cadastradas.
- Marcar como apenas visualizada não sobrescreve uma etapa já existente.
- Estados de candidatura nunca regridem: `generated` → `sent` → `responded`.
- Gerar a mensagem leva a vaga para `saved`; enviar ou responder leva para `applied`, salvo quando já está em entrevista, rejeitada ou arquivada.
- Notas e etapas são individuais por usuário e vaga.
- E-mails do LinkedIn reconhecidos podem atualizar automaticamente o pipeline quando existe uma única correspondência de vaga.

## 8. Aquisição, normalização e deduplicação

### Campos canônicos de uma vaga

Empresa, cargo e URL são obrigatórios. São aceitos ainda código externo, senioridade, modalidade, localização, stack, data, descrição, fonte, URL de candidatura, e-mail e assunto de contato.

### Normalização

- Cabeçalhos em português e inglês são mapeados para o modelo canônico.
- CSV aceita vírgula ou ponto e vírgula, aspas e BOM UTF-8.
- Localização vinda do LinkedIn é simplificada antes do separador `·`.
- Modalidade pode ser inferida de localização e descrição.
- ID do LinkedIn pode ser extraído da URL.
- Quando a data de publicação é inválida ou ausente, usa-se o momento da coleta.

### Deduplicação

O fingerprint FNV-1a de 32 bits usa empresa, cargo, localização e URL normalizados. `applyUrl` e contato ficam fora do fingerprint para permitir atualizar tokens e contatos sem duplicar a vaga.

Nas importações por e-mail, o ID externo do LinkedIn também participa da busca da vaga existente. Lotes repetidos são idempotentes: conflitos atualizam o registro e preservam contato já conhecido com `coalesce`.

### Limites operacionais

- Importação manual: até 2 MB e 2.000 vagas.
- CSV: no máximo 2.000 linhas de dados.
- Extensões: até 2.000 vagas por envio.
- Escritas D1: lotes de 50; consultas de fingerprints: lotes de 100.
- Coleta agendada: uma fonte por chamada, percorrida por `offset`; em execução manual, `start_offset` permite retomar de um ponto específico.
- Resiliência da coleta: pausa entre fontes, até seis tentativas para falhas transitórias e janela máxima de recuperação de 120 segundos por chamada.
- Descrição de ATS: normalizada e limitada a 12.000 caracteres por vaga antes da gravação, para respeitar os limites operacionais de Worker e D1.

## 9. Fontes e integrações

### ATS públicos

| Provedor | Endpoint | Dados principais |
|---|---|---|
| Greenhouse | Boards API | ID, cargo, local, atualização, URL e conteúdo |
| Lever | Postings API | ID, cargo, local, workplace type, URL e descrição |
| Ashby | Posting API | ID, cargo, local, remoto, publicação, URLs e descrição |

O identificador precisa conter apenas letras, números, `_` ou `-`. Chamadas têm timeout de 15 segundos. A validação classifica a fonte como `ok`, `empty`, `mismatch` ou `error`; Greenhouse e Ashby comparam também o nome encontrado.

O catálogo curado contém dezenas de boards previamente verificados. Slugs ambíguos exigem revisão manual, e fontes com board vazio ou colisão de empresa ficam em quarentena no código.

### Gmail RadarVagas

O Apps Script envia mensagens recentes da etiqueta exata `RadarVagas` usando Bearer token. O banco armazena apenas SHA-256 da chave e o usuário associado.

O conector:

- aceita somente a etiqueta esperada;
- extrai vagas de alertas do LinkedIn;
- reconhece assuntos de candidatura enviada ou visualizada;
- atualiza o pipeline apenas quando encontra uma correspondência única;
- tenta enriquecer descrições usando uma vaga oficial equivalente;
- prepara um resumo diário e aguarda confirmação de envio para marcar a entrega.

### Extensões de coleta

O endpoint dinâmico aceita somente `linkedin-extension` e `apinfo-extension`. Cada origem possui uma chave própria, armazenada apenas como hash. Há CORS para `POST` e `OPTIONS`, teste de conexão, importação idempotente e registro do lote.

O coletor APInfo legado que existia em `extensao-apinfo/` foi removido do repositório em 23/08/2026. O contrato push `apinfo-extension` e os dados já recebidos permanecem compatíveis, mas o código atual não distribui nem mantém uma extensão APInfo local. A extensão LinkedIn continua em repositório próprio. Quando um lote dessas duas origens é persistido com sucesso, o Worker pode iniciar a triagem agendada da fonte, se o interruptor administrativo estiver ativo.

### Enriquecimento e ciclo de vida

- Uma vaga de alerta pode receber descrição, stack, senioridade, modalidade e local de uma vaga oficial quando empresa e cargo normalizados têm correspondência única.
- Fontes ATS atualizam `lastSeenAt` a cada coleta.
- Após `staleAfterDays`, a vaga vira `possibly_closed`; após o dobro, `closed`; se reaparecer, volta a `active`.
- Cada transição gera um evento.

## 10. Dados e persistência

O schema atual possui **34 tabelas**:

| Tabela | Responsabilidade |
|---|---|
| `profiles` | identidade, papel básico, preferências, regras e versão do perfil |
| `local_accounts` | credenciais locais derivadas e origem do convite |
| `job_sources` | configuração, modo, saúde e validação das fontes |
| `jobs` | registro canônico, URLs, contato, status e datas da vaga |
| `company_contacts` | contato validado e reutilizável por chave normalizada da empresa |
| `user_job_status` | pipeline, nota e marcos da candidatura por usuário |
| `user_job_analyses` | análise elegível persistida por usuário e vaga |
| `triage_batches` | lotes manuais, agendados ou assistidos e seu estado global |
| `triage_history` | decisões aditivas por vaga, origem e versões das regras |
| `triage_batch_items` | fila, tentativas, lease, erro e resultado por vaga do lote |
| `triage_ai_reviews` | pedidos e snapshots destinados ao portal ou ao Codex |
| `triage_ai_review_chunks` | partes assíncronas e resultados parciais da revisão pela IA |
| `triage_deduplication` | chave de idempotência e lease por perfil/vaga/versões |
| `draft_outbox` | preparação, criação e confirmação dos rascunhos Gmail |
| `job_ai_facts` | cache factual de IA por vaga e versão da descrição |
| `job_ai_triage` | classificação automática legada mantida para compatibilidade |
| `ai_usage_events` | consumo, operação e resultado de chamadas de IA |
| `job_events` | eventos de ciclo de vida, enriquecimento e candidatura |
| `import_runs` | execução, origem, contadores, ator e falhas de importação |
| `automation_heartbeats` | último estado, horários e erro sanitizado de cada automação monitorada |
| `job_import_runs` | vínculo entre uma vaga e o lote que a recebeu |
| `platform_settings` | parâmetros operacionais globais |
| `alert_preferences` | ativação, frequência e score mínimo individual |
| `alert_reads` | vagas já lidas pelo usuário |
| `alert_deliveries` | preparação e confirmação de resumos diários |
| `notifications` | sino operacional para importação, triagem e candidatura |
| `roles` | perfis RBAC |
| `permissions` | catálogo fixo de capacidades administrativas |
| `role_permissions` | permissões de cada role |
| `groups` | grupos de acesso |
| `group_roles` | roles herdadas por grupo |
| `user_roles` | roles atribuídas diretamente a usuários |
| `user_groups` | grupos atribuídos a usuários |
| `access_audit_log` | trilha prevista para mudanças de acesso |

### Relações relevantes

- `jobs.source_id` aponta para `job_sources`.
- Pipeline, análises, triagem, outbox, fatos de IA, eventos, importações e leituras apontam para `jobs`.
- A chave composta usuário + vaga impede duplicidade no pipeline, na análise e nas leituras.
- A chave de idempotência da triagem combina usuário, vaga e versões de perfil/regras/instruções; leases protegem retomada e concorrência.
- `draft_outbox` limita uma entrada por usuário/vaga e garante unicidade tanto para `gmail_draft_id` quanto para `gmail_sent_id`.
- Roles chegam ao usuário diretamente ou pela associação grupo → role.
- Várias listas são armazenadas como JSON textual por compatibilidade com D1/SQLite.

### Evolução do banco

As migrations cobrem plataforma inicial, alertas, contas locais, fontes, RBAC, URLs e contatos, regras de carreira, análises, contabilidade de IA, importações rastreáveis e suas causas persistidas, notificações, perfil canônico, lotes e idempotência de triagem, outbox, revisão assíncrona, fila Codex, interruptores da automação agendada e heartbeats operacionais.

## 11. Autenticação, autorização e segurança

### Formas de autenticação

1. **Sign in with ChatGPT:** somente quando o host termina em `.chatgpt.site`; identidade vem de cabeçalhos protegidos.
2. **Conta local:** e-mail/senha, sessão HMAC em cookie seguro, HTTP-only, SameSite Lax e duração de 12 horas.
3. **Desenvolvimento local:** usuário fixo apenas em `localhost`/`127.0.0.1`.

Senhas locais usam PBKDF2-SHA-256, sal aleatório de 16 bytes, 25.000 iterações e comparação sem saída antecipada. A aplicação exige no mínimo quatro caracteres; o utilitário de bootstrap do proprietário exige oito.

### RBAC

`can()` concede acesso pela união de roles diretas e herdadas de grupos. O e-mail proprietário tem bypass explícito, independente do banco.

Existem 21 permissões cadastradas, entre elas fontes, coleta, importação, estatísticas, exclusão, configurações, monitoramento, qualidade, auditoria, backup, relatório, integrações, usuários, roles e grupos.

Perfis iniciais:

- **Admin operacional:** ampla operação, sem exclusão em massa, mudança de papel ou governança RBAC.
- **Curador de fontes:** fontes, coleta e monitoramento.
- **Visualizador:** leitura administrativa.

`roles.manage` e `groups.manage` não podem ser adicionadas a uma role pela API; na prática permanecem exclusivas do proprietário. Roles do sistema não podem ser excluídas e qualquer role vinculada precisa ser desatribuída antes da exclusão.

### Proteções de integração

- Cron de coleta, enriquecimento e ciclo de vida usa `COLLECTOR_SECRET`, removido pelo Worker antes do encaminhamento e substituído por cabeçalho interno.
- Gmail e extensões armazenam apenas hash SHA-256 das chaves.
- A rota de revalidação aceita sessão autorizada ou secret próprio.
- Credenciais de IA nunca são devolvidas ao navegador.
- Backup mascara a configuração protegida do Gmail e remove `updatedBy` das configurações.

## 12. Inventário de APIs

### Usuário e produto

| Método e rota | Função |
|---|---|
| `GET /api/health` | saúde do banco e latência |
| `GET/PUT /api/profile` | consultar/criar e atualizar perfil |
| `GET /api/jobs` | listar, buscar, filtrar, pontuar e paginar vagas |
| `POST /api/jobs/detail` | carregar descrição detalhada |
| `GET/POST /api/jobs/:id/analysis` | consultar ou persistir análise elegível |
| `POST /api/jobs/:id/intelligence` | fatos de IA e briefing de entrevista |
| `POST /api/jobs/:id/application` | avançar estado da candidatura |
| `PATCH /api/jobs/:id/contact` | salvar contato APinfo uma única vez |
| `GET/POST/DELETE /api/pipeline` | listar, mover/anotar e remover do pipeline |
| `GET/PUT/POST /api/alerts` | consultar, configurar e marcar alertas lidos |
| `GET /api/analytics` | métricas pessoais e rankings |
| `GET /api/ai/status` | provedor e consumo mensal de IA |
| `GET /api/notifications` | listar, marcar como lidas e abrir relatórios operacionais |
| `GET /api/triage/preview` | contar vagas do recorte antes de iniciar uma ação |
| `POST /api/triage/queue` | criar ou retomar um lote de triagem em fila |
| `POST /api/triage/run` | executar uma vaga ou rotina agendada com autenticação interna |
| `GET /api/triage/history` | lotes, itens, decisões, outbox e saúde operacional |
| `GET/POST /api/triage/ai-review` | criar e acompanhar revisão assíncrona pela IA do portal |
| `POST /api/triage/ai-review/run` | consumidor interno dos chunks da revisão |
| `GET/POST/PATCH /api/triage/codex-queue` | preparar, listar e concluir snapshots privados do Codex |
| `POST /api/triage/drafts/queue` | preparar, repetir, reconciliar ou confirmar rascunhos |

### Autenticação

| Método e rota | Função |
|---|---|
| `GET /api/auth/chatgpt` | encaminhar para autenticação hospedada |
| `POST /api/auth/register` | criar conta local e sessão |
| `POST /api/auth/login` | validar conta local e criar sessão |
| `POST /api/auth/logout` | remover sessão local |

### Administração

| Método e rota | Função |
|---|---|
| `GET /api/admin/audit` | linha do tempo de importações e vagas |
| `GET /api/admin/backup` | backup JSON protegido |
| `POST /api/admin/collect` | coleta manual individual, geral ou do catálogo |
| `GET/POST /api/admin/collector-key` | consultar/criar chave legada do coletor |
| `GET/POST /api/admin/collector-key/:sourceId` | chave por extensão permitida |
| `POST /api/admin/gmail-key` | configurar a chave Gmail |
| `POST /api/admin/import` | importar JSON/CSV |
| `GET /api/admin/imports/:id` | relatório detalhado de uma execução de importação |
| `GET/DELETE /api/admin/jobs` | estatísticas e exclusão de vagas |
| `GET /api/admin/monitor` | diagnóstico operacional |
| `GET /api/admin/permissions` | catálogo RBAC |
| `GET/POST /api/admin/quality` | relatório e enriquecimento |
| `POST /api/admin/report` | exportação CSV compatível com Excel |
| `GET /api/admin/triage` | consulta legada de triagem automática |
| `POST /api/admin/triage-import` | substituir vereditos a partir de CSV externo |
| `GET/POST /api/admin/roles` | listar e criar roles |
| `PATCH/DELETE /api/admin/roles/:roleId` | editar e excluir roles |
| `GET/PUT /api/admin/settings` | consultar e editar parâmetros |
| `GET/POST/PUT/PATCH /api/admin/sources` | listar, cadastrar, ativar catálogo e pausar fontes |
| `POST /api/admin/sources/test` | testar uma fonte ATS |
| `POST /api/admin/sources/revalidate` | revalidar fontes cadastradas |
| `GET/POST /api/admin/users` | listar e convidar usuários |
| `PATCH /api/admin/users/:userId` | alterar papel básico, protegido para owner |

### Integrações e automações

| Método e rota | Função |
|---|---|
| `OPTIONS/POST /api/collector/import` | endpoint legado da extensão LinkedIn |
| `OPTIONS/POST /api/collector/import/:sourceId` | entrada por extensão em allowlist |
| `POST /api/cron/collect` | coleta ATS paginada por fonte |
| `POST /api/cron/email-import` | importação de mensagens Gmail |
| `POST /api/cron/digest` | preparar/confirmar resumo diário |
| `POST /api/cron/enrich` | enriquecer vagas por fonte oficial |
| `POST /api/cron/lifecycle` | reconciliar vagas desatualizadas |
| `POST /api/cron/drafts` | criar rascunhos pendentes e reconciliar envios pelo conector Gmail |
| `POST /mcp/radar` | MCP privado para a fila de revisão do Codex |

## 13. Operação e entrega contínua

### Workflows

| Workflow | Gatilho | Comportamento |
|---|---|---|
| `Validar e publicar o Radar` | push/PR em `main`, manual | instala, builda, lint; no push aplica migrations D1 e publica o Worker |
| `Coleta diária de vagas` | 11:15 UTC em dias úteis, manual | percorre fontes por offset; depois enriquece e reconcilia ciclo de vida |
| `Revalidar fontes` | segunda, 06:00 UTC, manual | chama a revalidação do ambiente de produção |

O deploy tem concorrência exclusiva para produção e não cancela publicação em andamento. A validação executa build, lint, toda a suíte `*.test.mjs` e a integração RBAC. Antes do Worker, o job aplica migrations, garante as filas de triagem e suas DLQs e configura os segredos privados do Codex e do conector Gmail quando disponíveis.

O centro operacional apresenta a agenda declarada da coleta e da revalidação, além de identificar que a importação Gmail depende do conector externo. As execuções gravam `running`, `completed`, `failed` ou `skipped` em `automation_heartbeats`, com horários e erro sanitizado, permitindo distinguir uma agenda configurada de uma execução realmente observada.

### Variáveis e segredos operacionais

| Nome | Local | Uso |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub secret | migrations e deploy |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub secret | conta de produção |
| `RADAR_BASE_URL` | GitHub variable | base da coleta agendada |
| `COLLECTOR_SECRET` | GitHub/Worker secret | autenticar cron operacional |
| `REVALIDATION_SECRET` | GitHub/Worker secret | revalidar fontes |
| `RADAR_SESSION_SECRET` | Worker secret | assinar sessões locais |
| variáveis `OPENAI_*` ou `AI_*` | Worker secrets/vars | aprofundamento por IA |
| `RADAR_CODEX_MCP_TOKEN` | GitHub/Worker secret | autenticar o MCP privado do Codex |
| `GMAIL_DRAFTS_WEBHOOK_URL` | GitHub/Worker secret | solicitar criação ou reconciliação imediata de rascunhos |
| `GMAIL_DRAFTS_WEBHOOK_TOKEN` | GitHub/Worker secret | autenticar o webhook do Apps Script |

### Comandos de desenvolvimento

```bash
npm install
npm run dev
npm run build
npm run lint
npm test
npm run test:rbac-integration
npm run db:generate
```

## 14. Testes e garantias atuais

A base contém testes para:

- renderização e presença dos recursos centrais;
- autenticação local, contas convidadas e proteção administrativa;
- normalização de JSON/CSV, CORS, lotes e idempotência;
- extração de alertas e sinais de candidatura do Gmail;
- regras de score, senioridade, modalidade, recência e escopo de TI;
- bloqueadores, exceções, equivalências e fases do veredito;
- conteúdo seguro da mensagem APinfo;
- validação da resposta de IA, orçamento e briefing;
- RBAC estrutural e integração real com SQLite em memória;
- paginação e limites de recursos do Worker;
- período padrão e busca por código.
- perfil canônico e revisões de entrada da análise;
- decisão determinística, idempotência, armazenamento, escopo por usuário e retomada das filas de triagem;
- revisão assíncrona, chunks, fila Codex e aplicação de vereditos de IA;
- elegibilidade, prioridade, repetição e reconciliação da outbox Gmail;
- importação CSV de vereditos, contatos por empresa e ações individuais/em lote;
- notificações, relatórios de importação e saúde operacional da triagem.

`npm test` executa build e testes `*.test.mjs`. A integração RBAC usa loaders que simulam bindings Cloudflare e as migrations reais `0010`/`0011`; a esteira executa ambas as suítes antes da publicação.

Validação realizada em 24/08/2026: **159 testes regulares e 26 testes de integração RBAC passaram**. O lint terminou sem erros e com 7 avisos preexistentes em código de interface e versionamento de análise.

## 15. Pontos de atenção confirmados

Estes itens foram observados no código atual e devem orientar próximas decisões:

| Prioridade | Ponto | Impacto |
|---|---|---|
| Média | grupos, `user_roles`, `user_groups` e `access_audit_log` existem no banco, porém não há rotas/UI de atribuição nem gravação de auditoria de acesso | RBAC granular está parcialmente operacional, não administrável de ponta a ponta |
| Média | cache de fatos de IA é global por vaga, mas o consumo é atribuído apenas ao usuário que gerou o cache | usuários seguintes recebem o resultado sem novo evento de consumo; comportamento é eficiente, mas deve ser política explícita |
| Média | coletas gerais não possuem trava explícita de concorrência e falhas consecutivas aparecem no monitor sem alerta proativo | execuções sobrepostas ou falhas não observadas podem degradar a operação |
| Média | a coleta manual de ATS ainda consulta e grava cada vaga individualmente | fontes grandes podem consumir mais tempo e operações D1 que a coleta agendada em lotes |
| Média | a validação integrada manual da extensão LinkedIn 2.2.0 ainda precisa registrar aceitas, rejeitadas, novas e atualizadas | os testes automatizados cobrem as regras, mas não substituem a confirmação do fluxo real no navegador |
| Média | o código do coletor APInfo legado foi removido, mas o contrato `apinfo-extension` e referências operacionais ainda existem | é preciso manter clara a origem externa dos lotes e remover instruções que indiquem distribuição local da extensão |
| Média | vereditos podem vir de regras, IA do portal, Codex ou CSV | a trilha é persistida, mas a política de precedência e auditoria deve continuar explícita para evitar decisões opacas |
| Média | notificações e algumas rotas de triagem assistida são restritas à proprietária | a expansão para múltiplos operadores exigirá `userId`/broadcast e permissões específicas |
| Baixa | DLQs existem no Cloudflare, mas não há painel dedicado para inspecionar ou reprocessar mensagens mortas | falhas esgotadas dependem de observabilidade e operação externa |
| Baixa | health verifica banco; não verifica ATS, Gmail, IA nem secrets | “healthy” significa essencialmente D1 disponível |

Itens concluídos no ciclo de 13/08/2026: `report.export`, alinhamento de `offer`, exclusão referencial de IA, efeito integral das configurações operacionais, senha mínima unificada em 8 caracteres para novos cadastros/convites/bootstrap, paginação pós-filtro sem teto fixo de 150 candidatas, loader RBAC compatível com Windows/Node.js 24, documentação APinfo 1.6.2, backup ampliado e execução da suíte regular completa mais integração RBAC na esteira.

### Limitações assumidas pelo desenho

- ATS, LinkedIn e a origem externa APInfo podem mudar APIs/HTML sem aviso.
- A URL de candidatura APinfo pode expirar; a URL estável é apenas referência por código.
- O enriquecimento exige uma única correspondência exata de empresa e cargo normalizados.
- Alertas no portal examinam 100 vagas de 7 dias; o resumo diário examina 250 vagas de 24 horas e envia no máximo 10.
- Métricas de mercado usam as 500 vagas mais recentes, não toda a base.
- O backup foi ampliado, mas sua capacidade de restauração deve ser validada sempre que novas tabelas de triagem/outbox forem adicionadas.
- Cada implantação com outro D1 começa com dados independentes.

## 16. Mapa do repositório

| Caminho | Responsabilidade |
|---|---|
| `app/Dashboard.tsx` | experiência principal e coordenação dos módulos |
| `app/api/` | contratos HTTP e casos de uso do servidor |
| `app/*.tsx` | módulos visuais de operação, perfil e administração |
| `lib/scoring.ts` | score numérico e elegibilidade de senioridade |
| `lib/verdict.ts` | veredito em fases e análise de stack |
| `lib/personalized-analysis.ts` | composição da análise por perfil |
| `lib/ai-provider.ts` | provedor, extração e validação de fatos |
| `lib/job-intelligence.ts` | preparação de entrevista |
| `lib/canonical-profile.ts` / `analysis-versions.ts` | fonte de verdade e versionamento da decisão |
| `lib/deterministic-triage.ts` / `triage-orchestrator.ts` | regras, recortes e execução dos lotes |
| `lib/draft-eligibility.ts` / `gmail-draft-priority.ts` | segurança e acionamento dos rascunhos |
| `lib/apply-ai-verdict.ts` | aplicação oficial de vereditos do portal ou Codex |
| `lib/connectors.ts` | Greenhouse, Lever e Ashby |
| `lib/import-jobs.ts` / `csv-jobs.ts` | normalização de importações |
| `lib/email-jobs.ts` | alertas e candidatura via Gmail |
| `lib/enrichment.ts` / `lifecycle.ts` | qualidade e estado da vaga |
| `lib/rbac.ts` / `access.ts` | autorização granular e proteção do owner |
| `db/schema.ts` | modelo de dados tipado |
| `drizzle/` | histórico de migrations |
| `worker/index.ts` | fronteira Cloudflare, MCP, filas, pós-importação, cron e imagens |
| `.github/workflows/` | validação, deploy e rotinas |
| `public/gmail-radarvagas.gs` | conector Apps Script |
| `tests/` | regras, integração e limites operacionais |

## 17. Fluxos essenciais

### Descoberta até candidatura

```mermaid
sequenceDiagram
    participant U as Usuário
    participant R as Radar
    participant D as D1
    participant A as IA opcional

    U->>R: Define perfil e regras
    R->>D: Persiste versão do perfil
    U->>R: Busca e filtra vagas
    R->>D: Consulta candidatas paginadas
    R-->>U: Score e explicações
    U->>R: Abre vaga
    R-->>U: Veredito em quatro fases
    opt Aprofundar com IA
        R->>D: Verifica cache e orçamento
        R->>A: Extrai fatos comprováveis
        A-->>R: JSON estruturado
        R->>D: Cache e consumo
    end
    U->>R: Salva/anota/gera candidatura
    R->>D: Valida elegibilidade e atualiza pipeline
```

### Triagem até o rascunho

```mermaid
sequenceDiagram
    participant U as Pessoa usuária
    participant R as Radar
    participant Q as Cloudflare Queue
    participant A as IA ou Codex
    participant G as Gmail Apps Script
    participant D as D1

    U->>R: Escolhe fonte, período, área e canal
    R->>D: Cria lote e itens idempotentes
    R->>Q: Publica uma mensagem por vaga
    Q->>R: Executa regras com perfil canônico
    R->>D: Grava análise e histórico aditivo
    opt Revisão confirmada
        U->>R: Solicita IA, Codex ou importa CSV
        R->>A: Envia snapshot autorizado
        A-->>R: Vereditos e evidências
        R->>D: Registra veredito oficial de origem IA
    end
    R->>R: Revalida regras, contato e elegibilidade
    R->>D: Insere item seguro na outbox
    R->>G: Solicita criação do rascunho
    G-->>R: ID do rascunho ou envio encontrado
    R->>D: Atualiza outbox, pipeline e notificação
    Note over G: O conector nunca envia o e-mail
```

### Coleta agendada

```mermaid
sequenceDiagram
    participant G as GitHub Actions
    participant W as Worker
    participant ATS as ATS público
    participant D as D1

    loop Enquanto houver nextOffset
        G->>W: POST /api/cron/collect?offset=N
        W->>W: Valida COLLECTOR_SECRET
        W->>ATS: Coleta uma fonte
        ATS-->>W: Vagas
        W->>D: Deduplica e grava em lotes
        W-->>G: contadores e nextOffset
    end
    G->>W: POST /api/cron/enrich
    W->>D: Completa vagas compatíveis
    G->>W: POST /api/cron/lifecycle
    W->>D: Fecha ou reativa vagas
```

Em caso de indisponibilidade transitória, a chamada é repetida com intervalo controlado. Se for necessário retomar manualmente uma execução, o workflow aceita `start_offset`, evitando reprocessar as fontes anteriores. A validação operacional de 13/08/2026 confirmou o percurso das fontes restantes — incluindo Capco, com 734 vagas — e verificou enriquecimento e reconciliação do ciclo de vida. Um ciclo integral que se recupere de um `503` continua como verificação operacional pendente.

## 18. Definição prática do produto hoje

O Radar já é mais que um agregador: ele é um sistema pessoal de decisão e candidatura assistida com operação multiusuário. Seu diferencial técnico está na combinação de regras explicáveis, veto estratégico, filas rastreáveis, revisão por IA/Codex e automação limitada à preparação — a pessoa continua responsável pelo envio da candidatura.

Para evoluir com segurança, os próximos ajustes devem priorizar a administração RBAC ponta a ponta, a política de precedência dos vereditos, a operação das DLQs, a expansão das notificações para múltiplos operadores e a remoção das referências residuais ao coletor APInfo legado.
