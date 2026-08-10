const collectStatusElement = document.querySelector('#collect-status');
const exportStatusElement = document.querySelector('#export-status');
const stackOptions = document.querySelector('#stack-options');
const progressTotal = document.querySelector('#progress-total');
const progressPage = document.querySelector('#progress-page');
const progressResults = document.querySelector('#progress-results');

const DEFAULTS = {
  selectedStacks: [],
  stackMode: 'any',
  customTerms: '',
  excludedTerms: '',
  downloadFiles: true,
  sendRadar: false,
  downloadFolder: 'RadarCarreira',
  portalUrl: 'https://radar-carreira-platform.al-ramos.workers.dev/api/collector/import/apinfo-extension',
  portalToken: '',
};

const showCollectStatus = (text, error = false) => {
  collectStatusElement.textContent = text;
  collectStatusElement.classList.toggle('error', error);
};
const showExportStatus = (text, error = false) => {
  exportStatusElement.textContent = text;
  exportStatusElement.classList.toggle('error', error);
};

globalThis.STACK_CATALOG.forEach(stack => {
  const label = document.createElement('label');
  label.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = stack.id;
  label.append(input, document.createTextNode(stack.label));
  stackOptions.append(label);
});

function readSettings() {
  return {
    selectedStacks: [...stackOptions.querySelectorAll('input:checked')].map(input => input.value),
    stackMode: document.querySelector('#stack-mode').value,
    customTerms: document.querySelector('#custom-terms').value.trim(),
    excludedTerms: document.querySelector('#excluded-terms').value.trim(),
    downloadFiles: document.querySelector('#download-files').checked,
    sendRadar: document.querySelector('#send-radar').checked,
    downloadFolder: document.querySelector('#download-folder').value.trim(),
    portalUrl: document.querySelector('#portal-url').value.trim(),
    portalToken: document.querySelector('#portal-token').value.trim(),
  };
}

async function saveSettings(silent = false) {
  const settings = readSettings();
  if (settings.sendRadar && (!settings.portalUrl || !settings.portalToken)) {
    if (!silent) showExportStatus('Informe o endpoint e a chave do Radar.', true);
    return null;
  }
  await chrome.storage.local.set(settings);
  if (!silent) showExportStatus('Parâmetros salvos neste navegador.');
  return settings;
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  stackOptions.querySelectorAll('input').forEach(input => (input.checked = settings.selectedStacks.includes(input.value)));
  document.querySelector('#stack-mode').value = settings.stackMode;
  document.querySelector('#custom-terms').value = settings.customTerms;
  document.querySelector('#excluded-terms').value = settings.excludedTerms;
  document.querySelector('#download-files').checked = settings.downloadFiles;
  document.querySelector('#send-radar').checked = settings.sendRadar;
  document.querySelector('#download-folder').value = settings.downloadFolder;
  document.querySelector('#portal-url').value = settings.portalUrl;
  document.querySelector('#portal-token').value = settings.portalToken;
}

async function testRadar() {
  const settings = readSettings();
  if (!settings.portalUrl || !settings.portalToken) {
    showExportStatus('Informe o endpoint e a chave do Radar.', true);
    return;
  }
  showExportStatus('Testando a conexão com o Radar…');
  try {
    const response = await fetch(settings.portalUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.portalToken}` },
      body: JSON.stringify({ action: 'test' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Radar respondeu ${response.status}`);
    await chrome.storage.local.set(settings);
    showExportStatus('Conexão confirmada. A extensão já pode enviar vagas ao Radar.');
  } catch (error) {
    showExportStatus(`Não foi possível conectar: ${error.message}`, true);
  }
}

/** Atualiza os contadores do topo a partir do que já está acumulado. */
async function refreshProgress(extra = {}) {
  const response = await chrome.runtime.sendMessage({ type: 'GET_ACCUMULATED' });
  const total = response?.ok ? response.items.length : 0;
  progressTotal.textContent = String(total);
  if (extra.currentPage != null && extra.totalPages != null) {
    progressPage.textContent = `${extra.currentPage} de ${extra.totalPages}`;
  }
  if (extra.totalResults != null) {
    progressResults.textContent = String(extra.totalResults);
  }
}

/**
 * Acha a aba do APinfo a coletar. O painel roda na própria aba/janela dele
 * (options_page), então "aba ativa no momento do clique" seria o próprio
 * painel, não a busca do APinfo em segundo plano. host_permissions já cobre
 * apinfo.com, então dá para listar as abas desse domínio sem pedir a
 * permissão "tabs" completa — usa a mais recentemente acessada.
 */
async function findApinfoTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.apinfo.com/*' });
  if (!tabs.length) return null;
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0];
}

async function collectCurrentPage() {
  showCollectStatus('Lendo a página atual…');
  const tab = await findApinfoTab();
  if (!tab) {
    showCollectStatus('Nenhuma aba do APinfo encontrada. Abra a busca de vagas primeiro.', true);
    return;
  }
  chrome.runtime.sendMessage({ type: 'COLLECT_CURRENT_PAGE', tabId: tab.id }, async response => {
    if (chrome.runtime.lastError || !response?.ok) {
      showCollectStatus(response?.error || 'Não foi possível coletar esta página.', true);
      return;
    }
    await refreshProgress(response);
    showCollectStatus(
      `Página ${response.currentPage}: ${response.pageJobs} vagas lidas, ${response.added} novas. Total acumulado: ${response.totalAccumulated}.`,
    );
  });
}

const autoDelayInput = document.querySelector('#auto-delay');
const autoMaxPagesInput = document.querySelector('#auto-max-pages');
const autoStartButton = document.querySelector('#auto-collect-start');
const autoCancelButton = document.querySelector('#auto-collect-cancel');
const autoStatusElement = document.querySelector('#auto-collect-status');
const autoProgressBox = document.querySelector('#auto-progress');
const autoProgressFill = document.querySelector('#auto-progress-fill');
const autoProgressLabel = document.querySelector('#auto-progress-label');

let autoCollectPort = null;

const showAutoStatus = (text, error = false) => {
  autoStatusElement.textContent = text;
  autoStatusElement.classList.toggle('error', error);
};

function setAutoCollectRunning(running) {
  autoStartButton.disabled = running;
  autoCancelButton.disabled = !running;
  autoDelayInput.disabled = running;
  autoMaxPagesInput.disabled = running;
  autoProgressBox.hidden = !running;
  if (!running) {
    autoProgressFill.style.width = '0%';
  }
}

function updateAutoProgress({ currentPage, totalPages, collected }) {
  const pct = totalPages ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : 0;
  autoProgressFill.style.width = `${pct}%`;
  autoProgressLabel.textContent = `Página ${currentPage} de ${totalPages} — ${collected} vagas coletadas`;
}

async function startAutoCollect() {
  const tab = await findApinfoTab();
  if (!tab) {
    showAutoStatus('Nenhuma aba do APinfo encontrada. Abra a busca de vagas primeiro.', true);
    return;
  }

  const delayMs = Math.max(2, Number(autoDelayInput.value) || 4) * 1000;
  const maxPages = Math.max(1, Number(autoMaxPagesInput.value) || 200);

  setAutoCollectRunning(true);
  showAutoStatus('Iniciando coleta automática…');

  autoCollectPort = chrome.runtime.connect({ name: 'apinfo-auto-collect' });

  autoCollectPort.onMessage.addListener(async (message) => {
    if (message.type === 'PROGRESS') {
      updateAutoProgress(message);
      await refreshProgress(message);
      return;
    }
    if (message.type === 'DONE') {
      setAutoCollectRunning(false);
      await refreshProgress();
      const parts = [
        `Coleta concluída: ${message.collected} vagas lidas no total, ${message.added} novas.`,
        `Total acumulado: ${message.totalAccumulated}.`,
      ];
      if (message.stoppedReason) parts.push(message.stoppedReason);
      showAutoStatus(parts.join(' '), Boolean(message.stoppedReason));
      autoCollectPort = null;
      return;
    }
    if (message.type === 'ERROR') {
      setAutoCollectRunning(false);
      showAutoStatus(message.error || 'Falha na coleta automática.', true);
      autoCollectPort = null;
    }
  });

  autoCollectPort.onDisconnect.addListener(() => {
    autoCollectPort = null;
    setAutoCollectRunning(false);
  });

  autoCollectPort.postMessage({ type: 'START', tabId: tab.id, delayMs, maxPages });
}

function cancelAutoCollect() {
  if (!autoCollectPort) return;
  autoCollectPort.postMessage({ type: 'CANCEL' });
  autoCollectPort.disconnect();
  autoCollectPort = null;
  setAutoCollectRunning(false);
  showAutoStatus('Coleta automática cancelada. O que já foi lido permanece acumulado.');
}

async function clearAccumulated() {
  await chrome.runtime.sendMessage({ type: 'CLEAR_ACCUMULATED' });
  await refreshProgress();
  progressPage.textContent = '—';
  progressResults.textContent = '—';
  showCollectStatus('Acumulado limpo.');
}

async function exportAccumulated() {
  const settings = await saveSettings(true);
  if (!settings) {
    showExportStatus('Informe o endpoint e a chave do Radar.', true);
    return;
  }
  if (!settings.downloadFiles && !settings.sendRadar) {
    showExportStatus('Selecione ao menos um destino: Downloads ou Radar.', true);
    return;
  }
  showExportStatus('Exportando…');
  chrome.runtime.sendMessage({ type: 'EXPORT_ACCUMULATED', settings }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      showExportStatus(response?.error || 'Não foi possível exportar.', true);
      return;
    }
    const destino = [
      settings.downloadFiles ? 'CSV/JSON salvos' : '',
      response.radar
        ? `${response.radar.accepted ?? response.matched} aceitas pelo Radar, ${response.radar.inserted ?? 0} novas e ${response.radar.updated ?? 0} atualizadas`
        : '',
    ]
      .filter(Boolean)
      .join('; ');
    showExportStatus(`Concluído: ${response.total} lidas, ${response.matched} compatíveis com os filtros. ${destino}.`);
  });
}

document.querySelector('#collect-page').addEventListener('click', collectCurrentPage);
document.querySelector('#auto-collect-start').addEventListener('click', startAutoCollect);
document.querySelector('#auto-collect-cancel').addEventListener('click', cancelAutoCollect);
document.querySelector('#clear-accumulated').addEventListener('click', clearAccumulated);
document.querySelector('#open-apinfo').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.apinfo.com/apinfo/inc/list4.cfm' }));
document.querySelector('#save-settings').addEventListener('click', () => saveSettings());
document.querySelector('#test-radar').addEventListener('click', testRadar);
document.querySelector('#export').addEventListener('click', exportAccumulated);

loadSettings();
refreshProgress();
