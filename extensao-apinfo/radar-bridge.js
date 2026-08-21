/**
 * radar-bridge.js — content script injetado automaticamente nas páginas do
 * Radar de Carreira (declarado em content_scripts no manifest.json).
 *
 * Existe só para permitir que o painel do Radar consiga pedir à extensão
 * para ler contatos já visíveis em abas do APinfo — uma página web comum
 * não tem acesso a outras abas do navegador, só a extensão tem (via
 * chrome.scripting).
 *
 * Só repassa mensagens que vierem da própria janela do Radar (não de
 * terceiros, não de iframes) e só entende os pedidos específicos abaixo —
 * não expõe nenhuma outra capacidade da extensão à página.
 */

/** Portas de captura em lote ainda em andamento, por requestId — permite cancelar. */
const activeBatchPorts = new Map();

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== location.origin) return;

  const data = event.data;
  if (!data || data.source !== 'radar-dashboard') return;

  // Captura individual (1 vaga) — mesma aba que "Candidatar" acabou de abrir.
  if (data.type === 'RADAR_CAPTURE_CONTACT') {
    chrome.runtime.sendMessage({ type: 'CAPTURE_CONTACT_FOR_RADAR', externalId: data.externalId }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      window.postMessage(
        {
          source: 'radar-extension',
          type: 'RADAR_CAPTURE_CONTACT_RESULT',
          requestId: data.requestId,
          ...(runtimeError
            ? { ok: false, error: 'A extensão do APinfo precisa ser recarregada antes de capturar o contato.' }
            : response || { ok: false, error: 'A extensão não respondeu. Recarregue a página e tente de novo.' }),
        },
        location.origin,
      );
    });
    return;
  }

  // Captura em lote (N vagas) — a extensão abre uma aba própria por vaga,
  // em segundo plano, usando a sessão do APinfo já autenticada pela pessoa
  // no navegador. Progresso chega incrementalmente via porta; cada evento
  // vira uma mensagem separada de volta para a página, na ordem em que
  // chega da extensão.
  if (data.type === 'RADAR_CAPTURE_CONTACTS_BATCH') {
    const requestId = data.requestId;
    let port;
    let finished = false;
    const finishWithError = (error) => {
      if (finished) return;
      finished = true;
      activeBatchPorts.delete(requestId);
      window.postMessage(
        {
          source: 'radar-extension',
          type: 'RADAR_CAPTURE_CONTACTS_BATCH_RESULT',
          requestId,
          ok: false,
          error,
        },
        location.origin,
      );
    };
    try {
      port = chrome.runtime.connect({ name: 'apinfo-capture-contacts-batch' });
    } catch {
      window.postMessage(
        {
          source: 'radar-extension',
          type: 'RADAR_CAPTURE_CONTACTS_BATCH_RESULT',
          requestId,
          ok: false,
          error: 'A extensão do APinfo precisa ser recarregada antes de capturar em lote.',
        },
        location.origin,
      );
      return;
    }

    // Guarda a porta para que um pedido de CANCEL subsequente (mesmo
    // requestId) consiga achá-la.
    activeBatchPorts.set(requestId, port);

    port.onMessage.addListener((message) => {
      if (message?.type === 'PROGRESS') {
        window.postMessage(
          { source: 'radar-extension', type: 'RADAR_CAPTURE_CONTACTS_BATCH_PROGRESS', requestId, ...message },
          location.origin,
        );
        return;
      }
      // DONE ou ERROR encerram o ciclo desta porta.
      finished = true;
      activeBatchPorts.delete(requestId);
      window.postMessage(
        { source: 'radar-extension', type: 'RADAR_CAPTURE_CONTACTS_BATCH_RESULT', requestId, ...message },
        location.origin,
      );
    });
    port.onDisconnect.addListener(() => {
      // Cancelamento remove a porta do mapa antes de desconectá-la e já
      // publica um resultado "cancelled" abaixo; não deve virar erro.
      if (!activeBatchPorts.has(requestId)) return;
      activeBatchPorts.delete(requestId);
      // Sem este retorno o Radar não recebia DONE/ERROR quando a extensão
      // era recarregada, atualizada ou a porta caía antes da primeira vaga:
      // o botão ficava preso em "Capturando 0/N" indefinidamente.
      finishWithError('A comunicação com a extensão APInfo foi interrompida antes de concluir a próxima vaga. Recarregue a extensão e tente novamente.');
    });

    port.postMessage({ type: 'START', items: data.items, delayMs: data.delayMs });
    return;
  }

  if (data.type === 'RADAR_CAPTURE_CONTACTS_BATCH_CANCEL') {
    const port = activeBatchPorts.get(data.requestId);
    if (!port) return;
    activeBatchPorts.delete(data.requestId);
    // Mesmo padrão do painel próprio da extensão (dashboard.js/
    // cancelAutoCollect): pede o cancelamento e desconecta a porta em
    // seguida — o background.js para de postar assim que percebe o
    // onDisconnect, então a página nunca recebe uma resposta DONE/ERROR
    // depois de um CANCEL. Por isso a confirmação para a página é
    // sintetizada aqui, não esperada da porta.
    try {
      port.postMessage({ type: 'CANCEL' });
    } catch {
      /* porta já pode ter sido fechada */
    } finally {
      port.disconnect();
    }
    window.postMessage(
      { source: 'radar-extension', type: 'RADAR_CAPTURE_CONTACTS_BATCH_RESULT', requestId: data.requestId, ok: true, cancelled: true, found: 0, failed: 0 },
      location.origin,
    );
  }
});
