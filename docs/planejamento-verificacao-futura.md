# Planejamento para verificação futura

Documento de referência para acompanhar a evolução do Radar Carreira. Consolidado em 06/08/2026 e atualizado com os pendentes operacionais.

## Índice

1. [Contexto e objetivo](#1-contexto-e-objetivo)
2. [Situação atual](#2-situação-atual)
3. [Prioridades críticas (P0)](#3-prioridades-críticas-p0)
4. [Pendências confirmadas do próximo ciclo](#4-pendências-confirmadas-do-próximo-ciclo)
5. [Roadmap de produto](#5-roadmap-de-produto)
6. [Integração LinkedIn](#6-integração-linkedin)
7. [Filtros, análise e exportações](#7-filtros-análise-e-exportações)
8. [Cadastro de fontes ATS](#8-cadastro-de-fontes-ats)
9. [Operação e acesso de usuários](#9-operação-e-acesso-de-usuários)
10. [Checklist de verificação futura](#10-checklist-de-verificação-futura)

## 1. Contexto e objetivo

A implantação atual entrega bem o fluxo central de descoberta de vagas: radar, score de aderência, busca, filtros básicos, perfil, salvar/descartar, etapas de candidatura e link para LinkedIn.

O objetivo das próximas entregas é conectar essa experiência enxuta aos módulos operacionais que já existem no repositório, transformando a aplicação de uma lista de vagas em uma ferramenta de decisão e acompanhamento de carreira.

## 2. Situação atual

### Recursos já disponíveis na implantação

- Radar de vagas, busca e filtros por modalidade e score mínimo.
- Perfil básico, salvar/descartar vagas e etapas da candidatura.
- Link para LinkedIn.

### Recursos existentes no repositório que precisam ser expostos ou integrados

- Pipeline com notas, movimentação, oferta e encerramento.
- Alertas e resumo diário por e-mail.
- Métricas pessoais de conversão, empresas e tecnologias.
- Perfil avançado: senioridade, cidades, áreas, termos a evitar e score mínimo.
- Importação CSV/JSON, Gmail RadarVagas e coleta em Greenhouse, Lever e Ashby.
- Administração: fontes, monitoramento, auditoria, qualidade de dados, usuários, backup e relatório Excel.

### Situação de publicação

- A última publicação automática disparada por `push` concluiu com sucesso.
- Cancelamentos anteriores ocorreram porque uma execução manual foi iniciada enquanto outras publicações automáticas aguardavam na fila.
- Procedimento recomendado: deixar o último `push` concluir a publicação automaticamente; não disparar publicação manual concorrente.

### Atualização operacional — 13/08/2026

- A coleta agendada foi estabilizada com gravações em lote, pausa entre fontes e tentativas controladas para indisponibilidades transitórias.
- O workflow manual agora aceita `start_offset`, permitindo retomar a partir da fonte interrompida sem repetir o início do ciclo.
- Descrições extensas de ATS são normalizadas e limitadas a 12.000 caracteres por vaga antes da gravação.
- A retomada percorreu as fontes restantes, incluindo Capco (734 vagas); enriquecimento e ciclo de vida foram verificados separadamente.
- Próxima verificação: concluir um ciclo integral que passe por uma recuperação de `503` sem perder a resposta JSON válida.

### Riscos de produto e operação

- A data de atualização exibida pode ficar desatualizada e reduzir a confiança no radar.
- README e implantação podem apontar para URLs de produção diferentes, indicando risco de versões divergentes.
- Fontes manuais podem estar sendo tratadas indevidamente pelo agendamento automático.

## 3. Prioridades críticas (P0)

| ID | Atividade | Resultado esperado | Verificação |
|---|---|---|---|
| P0-01 | Separar fontes automáticas e manuais no agendamento | Gmail e extensão LinkedIn não são coletados como ATS | Rotina diária processa apenas fontes compatíveis com Greenhouse, Lever e Ashby |
| P0-02 | Chaves LinkedIn por usuário/dispositivo | Chaves nomeáveis, revogáveis e renováveis sem afetar outros coletores | Revogar uma chave bloqueia somente aquele dispositivo |
| P0-03 | Testar fontes reais de ATS | Cadastro, teste e coleta validados contra fontes públicas reais | Ao menos uma fonte Greenhouse, Lever e Ashby é testada com sucesso e falhas compreensíveis |
| P0-04 | Fechar a operação diária de coleta | Coletas gerais confiáveis e administráveis | **Parcial:** recuperação e retomada por offset validadas; ainda falta bloquear coletas gerais concorrentes e alertar administradores |
| P0-05 | Expor todas as vagas | Usuário acessa vagas além das 250 mais recentes | Paginação ou “Carregar mais” recupera resultados adicionais sem divergência do total |

## 4. Pendências confirmadas do próximo ciclo

### 4.1 Testar fontes de verdade

- Validar URLs públicas reais de Greenhouse, Lever e Ashby.
- Testar **Salvar e testar**, coleta individual e cenários de falha reais.
- Criar testes funcionais de parsing, além dos testes estruturais existentes.
- Registrar exemplos de URLs válidas e erros esperados por plataforma.

### 4.2 Fechar a operação diária

- Bloquear **Coletar todas** quando outra coleta geral estiver em andamento.
- Converter erros técnicos em mensagens úteis, com orientação de próxima ação.
- Alertar administradores após falhas consecutivas de coleta.
- Registrar execução, duração, fonte, resultado e erro para auditoria.

### 4.3 Mostrar todas as vagas

- Manter a exibição do total real de vagas.
- Implementar paginação ou ação **Carregar mais**; a tela não deve ficar limitada às 250 vagas mais recentes.
- Preservar filtros, ordenação e total ao navegar entre páginas ou carregar novos resultados.

### 4.4 Ampliar as fontes de coleta

- Adicionar suporte genérico a RSS.
- Adicionar suporte a JSON-LD genérico.
- Priorizar conectores adicionais conforme a lista de empresas-alvo.
- Validar qualidade, deduplicação e atribuição de empresa antes de ativar cada conector em produção.

### 4.5 Revisar mudanças locais antes de publicar

- Há mudanças locais de administração/autenticação e a migration `0007` ainda não publicadas.
- Revisar escopo e diff, executar testes relevantes e validar impacto de banco/permissões.
- Publicar essas alterações em ciclo próprio, sem misturá-las a mudanças não relacionadas.

## 5. Roadmap de produto

| Etapa | Entrega | Estimativa | Dependência |
|---|---|---:|---|
| 0 — Estabilização | Cron para fontes manuais, fontes ATS reais, concorrência da coleta, paginação e auditoria | 2–4 dias | — |
| 1 — Integração madura | Chaves por dispositivo, revogação, histórico e diagnóstico da extensão | 4–6 dias | Etapa 0 |
| 2 — Filtros e buscas salvas | Filtros avançados por empresa, tecnologia e origem | 5–8 dias | Dados consistentes |
| 3 — Análise da vaga | Score explicável, lacunas, alertas e recomendação | 6–10 dias | Perfil e enriquecimento |
| 4 — Exportações e métricas | CSV/Excel pessoal, PDF semanal, funil e eficiência por busca/fonte | 4–7 dias | Pipeline e filtros |
| 5 — Inteligência contínua | Alertas por busca, comparação de vagas e recomendações do pipeline | 6–10 dias | Etapas 2 a 4 |

Ordem recomendada: **estabilização → LinkedIn (chaves e histórico) → filtros salvos → análise detalhada → exportações e métricas**.

## 6. Integração LinkedIn

### Confiabilidade e segurança

- Deduplicar primeiro pelo ID da vaga LinkedIn; usar fingerprint apenas como complemento.
- Criar chaves por usuário/dispositivo, com nome, expiração, rotação e revogação.
- Cobrir chave inválida, conexão, envio, deduplicação e limite de lote com testes reais.
- Manter o coletor como extensão local, utilizando a sessão autenticada do navegador; não automatizar login em servidor.

### Histórico e diagnóstico

- Registrar data, busca, páginas processadas, vagas recebidas, novas, atualizadas, rejeitadas e erros.
- Mostrar diagnóstico da extensão: conexão, versão, endpoint, última importação e expiração de chave.
- Registrar a origem da vaga e o campo “última vez vista no LinkedIn”.

### Dados adicionais a capturar

- Termo e filtros usados na busca; datas de coleta e publicação.
- Tipo de contratação, senioridade, modalidade, local, candidatos e candidatura simplificada.
- Salário, empresa, setor, URL da empresa, idioma e tecnologias detectadas.

## 7. Filtros, análise e exportações

### Filtros e buscas salvas

Priorizar modalidade, localidade, senioridade, contrato, tecnologias (incluir/excluir; qualquer/todas), empresas-alvo/bloqueadas, origem, datas, status, qualidade de dados e critérios LinkedIn.

Permitir salvar buscas reutilizáveis, por exemplo: “Cloud Security remoto”, “DevSecOps São Paulo” e “Vagas para candidatura rápida”.

### Análise de aderência da vaga

- Explicar o score por critério e registrar versão da regra usada.
- Exibir competências encontradas/faltantes e requisitos obrigatórios/desejáveis.
- Indicar compatibilidade de senioridade, modalidade e localização.
- Destacar alertas: plantão, presencial integral, inglês avançado e PJ.
- Estruturar responsabilidades, requisitos, benefícios, salário e processo seletivo.
- Recomendar candidatar-se, revisar ou descartar; sugerir ação prática.
- Recalcular score após enriquecimento de descrição e tecnologias.

### Exportações e métricas

- Exportar a lista filtrada em CSV, Excel e JSON, com filtros e data de geração.
- Gerar relatório semanal PDF/Excel com vagas, scores, decisões e pipeline.
- Exportar vaga individual com análise e checklist de candidatura.
- Disponibilizar empresas e tecnologias mais frequentes.
- Permitir envio para planilha somente com conta Google autorizada.
- Medir conversão para entrevista/oferta e eficiência por busca/fonte.

## 8. Cadastro de fontes ATS

### Problema identificado

O formulário atual pede o nome da empresa antes de explicar que a pessoa está cadastrando uma página de carreiras/ATS. “Identificador” é um termo técnico e ambíguo.

### Evolução priorizada

| Prioridade | Atividade | Critério de aceite |
|---|---|---|
| P0 | Reordenar para Plataforma → Link da página de carreiras → Empresa das vagas | Usuário entende o objetivo do cadastro antes de preencher o nome |
| P0 | Trocar “Identificador” por URL e extrair/validar o slug | `externalRef` continua preenchido internamente |
| P1 | Sugerir empresa a partir do slug, permitindo edição | Nome sugerido pode ser alterado antes de salvar |
| P1 | Adicionar ajuda e exemplos por ATS | Greenhouse, Lever e Ashby exibem URLs adequadas |
| P2 | Criar testes de interface e parsing | URLs válidas/inválidas, slug e nome editado são cobertos |

### Fluxo desejado

1. Modal: **Adicionar página de carreiras**.
2. Texto: “Informe a página pública onde a empresa divulga vagas. O Radar fará a coleta automaticamente.”
3. Campo de URL com exemplos dinâmicos por plataforma.
4. Detecção da plataforma e sugestão de empresa após colar a URL.
5. Ação “Salvar e testar”, separada da coleta efetiva, com resultado claro.

## 9. Operação e acesso de usuários

### Convite de usuários

1. Acessar **Usuários** com a conta proprietária.
2. Em **Convidar usuário**, preencher nome, e-mail e senha inicial com pelo menos 12 caracteres.
3. Criar o convite.
4. Enviar manualmente, por canal seguro, o link do Radar, e-mail e senha inicial.

### Restrições atuais a confirmar antes de uso

- O acesso é por e-mail e senha; não pelo botão ChatGPT.
- O convite cria perfil de administrador.
- Não há e-mail automático de convite.

## 10. Checklist de verificação futura

### Antes de liberar uma etapa

- [ ] Funcionalidade publicada no ambiente de produção correto.
- [ ] Publicação automática por `push` aguardada até concluir, sem execução manual concorrente.
- [ ] Testes automatizados e validação manual concluídos.
- [ ] Auditoria, tratamento de erro e mensagens ao usuário verificados.
- [ ] Dados existentes e permissões preservados.
- [ ] Migrations revisadas e validadas no ambiente apropriado antes da publicação.
- [ ] README e documentação atualizados.

### Indicadores para acompanhar

- [ ] Data de atualização da base e taxa de sucesso das coletas.
- [ ] Duplicatas por origem, especialmente LinkedIn.
- [ ] Fontes ATS que coletam com sucesso na primeira tentativa.
- [ ] Uso de filtros e buscas salvas.
- [ ] Conversão descoberta → salva → candidatura → entrevista → oferta.
- [ ] Erros de cadastro de fontes e de integração da extensão.
- [ ] Número de coletas gerais bloqueadas por execução concorrente.
- [ ] Falhas consecutivas por fonte e alertas administrativos enviados.
- [ ] Quantidade de vagas acessadas além das primeiras 250.
