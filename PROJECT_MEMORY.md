# Memória do Projeto — Radar de Carreira

Este arquivo preserva decisões operacionais duradouras. Atualize-o quando uma decisão mudar a forma de localizar, executar ou publicar o projeto.

## Estrutura local

- A pasta que concentra as branches locais chama-se `RadarCarreira`.
- Nome anterior: `AMR`.
- Ao citar, localizar ou criar trabalho nessa estrutura, use `RadarCarreira`; não reutilize `AMR`.

## Operação e publicação

- A fonte de verdade de cada componente deve ser confirmada antes de alterações.
- Neste repositório, novas branches devem seguir o padrão `codex/<nome-da-tarefa>`.
- Entregas validadas são publicadas via GitHub Actions: commit e push para `main`, acompanhando o workflow **Validar e publicar o Radar** até o job **Publicar no Cloudflare** concluir com sucesso.
- Alterações locais não relacionadas devem ser preservadas e isoladas da entrega.

## Registro de mudanças

| Data | Atualização |
| --- | --- |
| 2026-08-31 | Definido `codex/<nome-da-tarefa>` como padrão para novas branches do repositório. |
| 2026-08-26 | Renomeada a pasta de branches locais de `AMR` para `RadarCarreira`. |
