# Design QA — Radar simplificado

## Evidências

- Fonte visual: `C:\Users\al-ra\AppData\Local\Temp\codex-clipboard-718966b6-b22e-4985-b942-77e8faaef095.png`
- Implementação (estado recolhido): `ui-simplified-preview.png`
- Implementação (filtros abertos): `ui-simplified-filters.png`
- Comparação lado a lado: `design-qa-comparison.png`
- Viewport da implementação: 1280 × 720 CSS px, densidade 1×.
- Fonte: 1638 × 906 px; normalizada proporcionalmente para 1299 × 720 px na comparação.
- Estado: área Radar autenticada; a fonte contém quatro vagas, enquanto o ambiente local não retornou vagas. Os filtros foram abertos para comparar a superfície de controles em um estado equivalente.

## Interações verificadas

- O botão **Filtros** abre e fecha o painel e expõe um estado `aria-expanded` correto.
- Selecionar **Meu perfil (60% ou mais)** atualiza o contador para `Filtros 1`.
- **Limpar filtros** restaura o botão para `Filtros`.
- Não houve erros no console do navegador durante essas ações.

## Avaliação das superfícies de fidelidade

- **Tipografia:** a hierarquia do título, busca e filtros permanece consistente com a identidade atual; o painel reduz o volume de rótulos visíveis na entrada.
- **Espaçamento e layout:** a linha superior passou a conter apenas busca, período e filtros. Ao abrir, os filtros têm espaço próprio e não comprimem a área de vagas.
- **Cores e tokens:** foram preservados os tokens azul-marinho, lilás e coral já presentes no produto; os fundos completos por score foram removidos para reduzir peso visual.
- **Imagens e ícones:** não foram adicionados ou substituídos assets visuais.
- **Conteúdo:** os rótulos foram encurtados sem remover os filtros, e as ações secundárias do detalhe foram agrupadas em **Mais ações**.

## Findings

Nenhum achado P0, P1 ou P2 na superfície visível e nas interações verificadas.

## Limites de verificação

- A prévia local não possuía vagas retornadas pela API; por isso, a lista compacta de cards e o menu **Mais ações** do detalhe foram verificados por compilação, não em estado visual com dados reais.
- Esse é um gap de cobertura, não um problema visual observado. A próxima sessão com vagas carregadas deve conferir apenas o estado populado em desktop e mobile.

## Histórico de comparação

1. Comparação da tela de referência com o painel de filtros aberto: confirmou a redução da densidade inicial e a preservação dos filtros sob demanda.
2. Sem achados acionáveis; nenhuma nova iteração P0/P1/P2 foi necessária.

## Resultado

final result: passed
