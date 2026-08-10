const showStatus = (text, error = false) => {
  const el = document.querySelector('#status');
  el.textContent = text;
  el.classList.toggle('error', error);
};

document.querySelector('#dashboard').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#open').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.apinfo.com/apinfo/inc/list4.cfm' }));

document.querySelector('#collect').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.apinfo.com/')) {
    showStatus('Abra uma busca de vagas do APinfo primeiro.', true);
    return;
  }
  showStatus('Coletando esta página…');
  chrome.runtime.sendMessage({ type: 'COLLECT_CURRENT_PAGE', tabId: tab.id }, response => {
    if (chrome.runtime.lastError || !response?.ok) {
      showStatus(response?.error || 'Não foi possível coletar. Abra o painel completo para mais detalhes.', true);
      return;
    }
    showStatus(`${response.added} vagas novas. Total acumulado: ${response.totalAccumulated}. Abra o painel para exportar.`);
  });
});
