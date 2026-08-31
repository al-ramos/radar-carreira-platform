# Verificações futuras do Radar Carreira

Este documento contém apenas verificações ainda pendentes ou recorrentes. O estado implementado da plataforma não é repetido aqui: consulte o [README](../README.md), a [visão completa do produto e da arquitetura](visao-completa-do-projeto.md) e o hub do projeto no Notion.

## Referência atual

- Marco funcional: commit [`d2af6b7`](https://github.com/al-ramos/radar-carreira-platform/commit/d2af6b7f5c7cfb15f75666f8f3cccb93622e46d3), de 28/08/2026.
- Publicação confirmada: workflow [`33212195271`](https://github.com/al-ramos/radar-carreira-platform/actions/runs/33212195271), incluindo o job **Publicar no Cloudflare**.
- Produção: [radar-carreira-platform.al-ramos.workers.dev](https://radar-carreira-platform.al-ramos.workers.dev).
- Fonte de verdade de produto e arquitetura: documentação versionada neste repositório.
- Fonte de verdade de status, responsáveis e próximos passos: backlog e log de entregas no Notion.
- Fonte de verdade operacional: monitoramento e heartbeats persistidos no próprio Radar.

## Verificações recorrentes

### P0 — operação e segurança

- Confirmar que coleta, triagem, filas, DLQs e criação de rascunhos exibem última execução, próxima execução, totais, falhas e motivo acionável.
- Exercitar a restauração do backup sempre que migrations alterarem dados de triagem, histórico, outbox ou candidaturas.
- Auditar RBAC ponta a ponta antes de ampliar funções administrativas ou permitir múltiplos operadores.
- Verificar que o envio automático permanece restrito à autorização explícita registrada, a veredito `✅`, contato válido e outbox confirmada.
- Validar a recuperação de aprovações `✅` sem histórico ou sem outbox e confirmar que a idempotência impede rascunhos duplicados.

### P1 — integrações críticas

- Validar periodicamente a extensão LinkedIn no Chrome, incluindo captura, abertura da candidatura, recarga da pasta publicada e mudança de HTML do site.
- Confirmar o Apps Script Gmail após mudanças no contrato: criação de rascunho, anexo do currículo, retentativa, reconciliação da pasta Enviados e ausência de envio automático.
- Testar cada fonte ATS ativa e registrar alterações de API, paginação, limites ou autenticação.
- Ampliar notificações para múltiplos operadores somente depois de definir escopo por usuário, permissões e política de broadcast.

### P2 — evolução de produto

- Tornar a precedência entre regras, IA do portal, Codex, CSV e decisão manual visível em uma única visão de auditoria.
- Avaliar buscas salvas, novas fontes e métricas adicionais a partir de demanda observada, sem duplicar filtros já disponíveis.
- Remover referências residuais ao coletor APInfo legado quando não forem necessárias para compatibilidade dos lotes externos.

## Checklist para cada entrega

- [ ] Confirmar a fonte de verdade e registrar `git status --short`, worktrees e locks antes de editar.
- [ ] Preservar alterações locais não relacionadas; usar clone ou worktree limpo quando houver concorrência.
- [ ] Atualizar somente a documentação afetada e o card ou log correspondente no Notion.
- [ ] Executar build, testes afetados, integração RBAC e lint em proporção ao risco.
- [ ] Fazer commit e push para `main` sem misturar arquivos alheios.
- [ ] Acompanhar o workflow **Validar e publicar o Radar** até o job **Publicar no Cloudflare** concluir com sucesso.
- [ ] Registrar commit, workflow, evidências, validação e próximo passo no Notion.
- [ ] Remover ambiente temporário exclusivo da publicação somente quando estiver limpo e a produção estiver confirmada.

## Critério de encerramento

Uma verificação só está concluída quando existe evidência reproduzível no repositório, no CI ou no monitor operacional. Lista de intenção, interface visível ou commit sem publicação confirmada não constituem conclusão.
