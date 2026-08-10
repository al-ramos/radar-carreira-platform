/**
 * OBSOLETO — este arquivo não é mais usado.
 *
 * A lógica de avanço de página (submeter o mini-form nativo "Pular para a
 * página" do APinfo) foi movida para dentro de background.js como a função
 * `submitPagingForm`, injetada via `chrome.scripting.executeScript({ func,
 * args })`.
 *
 * Motivo da mudança: `chrome.scripting.executeScript` com `files: [...]`
 * não aceita `args` — só a forma `func: ...` (função inline) aceita
 * argumentos. Este arquivo precisava receber o número da página de destino
 * como parâmetro, então precisou virar função inline em vez de arquivo
 * separado. Este arquivo não é referenciado em nenhum manifest, background
 * ou dashboard — pode ser ignorado.
 *
 * Ver: background.js → submitPagingForm() e advanceToPage().
 */
