/**
 * radar-bridge.js — content script injetado automaticamente nas páginas do
 * Radar de Carreira (declarado em content_scripts no manifest.json).
 *
 * Existe só para permitir que o botão "Capturar e-mail" do próprio painel
 * do Radar consiga pedir à extensão para ler o contato já visível numa aba
 * do APinfo aberta em outra aba — uma página web comum não tem acesso a
 * outras abas do navegador, só a extensão tem (via chrome.scripting).
 *
 * Só repassa mensagens que vierem da própria janela do Radar (não de
 * terceiros, não de iframes) e só entende esse pedido específico — não
 * expõe nenhuma outra capacidade da extensão à página.
 */
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== location.origin) return;

  const data = event.data;
  if (!data || data.source !== 'radar-dashboard' || data.type !== 'RADAR_CAPTURE_CONTACT') return;

  chrome.runtime.sendMessage({ type: 'CAPTURE_CONTACT_FOR_RADAR', externalId: data.externalId }, (response) => {
    window.postMessage(
      {
        source: 'radar-extension',
        type: 'RADAR_CAPTURE_CONTACT_RESULT',
        requestId: data.requestId,
        ...(response || { ok: false, error: 'A extensão não respondeu. Recarregue a página e tente de novo.' }),
      },
      location.origin,
    );
  });
});
