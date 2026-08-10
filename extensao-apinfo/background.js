importScripts('stacks.js');

/**
 * background.js — service worker da extensão.
 *
 * Diferente do coletor do LinkedIn, esta extensão NÃO navega páginas
 * automaticamente nem simula cliques na paginação do APinfo: o site usa
 * um formulário de busca com filtros (estado, cidade, cargo) que só são
 * preservados quando a própria pessoa navega pelos controles nativos da
 * página. Automatizar isso reconstruiria a busca sem esses filtros.
 *
 * O fluxo aqui é: a pessoa navega manualmente até a página que quer, clica
 * em "Coletar esta página" no painel, e o resultado se acumula em
 * chrome.storage.session até ela exportar ou limpar.
 */

const normalized = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const matches = (text, term) => {
  const escaped = normalized(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(normalized(text));
};

function applyStackFilter(items, settings) {
  const selected = new Set(settings.selectedStacks || []);
  const mode = settings.stackMode === 'all' ? 'all' : 'any';
  const custom = String(settings.customTerms || '').split(',').map(t => t.trim()).filter(Boolean);
  const excluded = String(settings.excludedTerms || '').split(',').map(t => t.trim()).filter(Boolean);

  return items
    .map(job => {
      const text = `${job.titulo || ''} ${job.descricao || ''}`;
      const detected = globalThis.STACK_CATALOG.filter(stack => stack.terms.some(term => matches(text, term)));
      const customMatched = custom.filter(term => matches(text, term));
      const excludedMatched = excluded.filter(term => matches(text, term));
      const selectedMatched = detected.filter(stack => selected.has(stack.id)).map(stack => stack.id);
      return {
        ...job,
        stack: [...new Set([...detected.map(s => s.label), ...customMatched])],
        _selectedMatched: selectedMatched,
        _customMatched: customMatched,
        _excludedMatched: excludedMatched,
      };
    })
    .filter(job => {
      if (job._excludedMatched.length) return false;
      if (!selected.size && !custom.length) return true;
      const stackMatch = selected.size
        ? (mode === 'all' ? [...selected].every(id => job._selectedMatched.includes(id)) : job._selectedMatched.length > 0)
        : false;
      return Boolean(stackMatch || job._customMatched.length > 0);
    })
    .map(({ _selectedMatched, _customMatched, _excludedMatched, ...job }) => job);
}

const cleanFolder = value => String(value || '').split(/[\\/]+/).map(part => part.replace(/[<>:"|?*]/g, '').trim()).filter(Boolean).join('/');

async function downloadData(content, mime, filename) {
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
  await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
}

async function downloadJobs(items, folder) {
  const cols = ['codigo_apinfo', 'titulo', 'empresa', 'local', 'data_publicacao', 'descricao', 'stack', 'link', 'link_candidatura', 'coletado_em', 'pagina'];
  const esc = value => `"${String(Array.isArray(value) ? value.join(', ') : value ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.join(';'), ...items.map(job => cols.map(col => esc(job[col])).join(';'))].join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  const prefix = cleanFolder(folder);
  await downloadData(csv, 'text/csv', `${prefix ? prefix + '/' : ''}vagas-apinfo-${stamp}.csv`);
  await downloadData(JSON.stringify(items, null, 2), 'application/json', `${prefix ? prefix + '/' : ''}vagas-apinfo-${stamp}.json`);
}

async function sendToRadar(items, settings) {
  const jobs = items.map(job => ({
    externalId: job.codigo_apinfo,
    title: job.titulo,
    company: job.empresa,
    location: job.local,
    description: job.descricao,
    stack: job.stack,
    url: job.link,
  }));
  const response = await fetch(settings.portalUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${settings.portalToken}` },
    body: JSON.stringify({ source: 'apinfo-extension', stacks: settings.selectedStacks || [], jobs }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Radar respondeu ${response.status}`);
  return data;
}

/** Injeta page-collector.js na aba ativa e devolve o resultado bruto (sem filtro de stack ainda). */
async function collectActiveTab(tabId) {
  const [tab] = await chrome.tabs.query({ active: true, windowId: (await chrome.tabs.get(tabId)).windowId });
  if (!tab || !tab.url || !/^https:\/\/www\.apinfo\.com\//.test(tab.url)) {
    throw new Error('Abra uma página de resultados do APinfo antes de coletar.');
  }
  const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-collector.js'] });
  return result[0]?.result || { jobs: [], totalResults: 0, currentPage: 1, totalPages: 1 };
}

/** Acumula vagas coletadas entre chamadas, deduplicadas por código da vaga. */
async function getAccumulated() {
  const { apinfoAccumulated } = await chrome.storage.session.get('apinfoAccumulated');
  return apinfoAccumulated || [];
}
async function setAccumulated(items) {
  await chrome.storage.session.set({ apinfoAccumulated: items });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'COLLECT_CURRENT_PAGE') {
    (async () => {
      try {
        const tabId = message.tabId || sender.tab?.id;
        if (!tabId) throw new Error('Nenhuma aba ativa identificada.');
        const { jobs, totalResults, currentPage, totalPages } = await collectActiveTab(tabId);

        const current = await getAccumulated();
        const byCode = new Map(current.map(job => [job.codigo_apinfo, job]));
        let added = 0;
        for (const job of jobs) {
          if (!byCode.has(job.codigo_apinfo)) added++;
          byCode.set(job.codigo_apinfo, job);
        }
        const accumulated = [...byCode.values()];
        await setAccumulated(accumulated);

        sendResponse({
          ok: true,
          pageJobs: jobs.length,
          added,
          totalAccumulated: accumulated.length,
          totalResults,
          currentPage,
          totalPages,
        });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || 'Falha ao coletar a página atual.' });
      }
    })();
    return true;
  }

  if (message?.type === 'GET_ACCUMULATED') {
    (async () => {
      const accumulated = await getAccumulated();
      sendResponse({ ok: true, items: accumulated });
    })();
    return true;
  }

  if (message?.type === 'CLEAR_ACCUMULATED') {
    (async () => {
      await setAccumulated([]);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'EXPORT_ACCUMULATED') {
    (async () => {
      try {
        const accumulated = await getAccumulated();
        const settings = message.settings || {};
        const jobs = applyStackFilter(accumulated, settings);
        if (!jobs.length) {
          sendResponse({ ok: false, error: `${accumulated.length} vagas lidas, nenhuma corresponde aos filtros definidos.` });
          return;
        }
        if (settings.downloadFiles) await downloadJobs(jobs, settings.downloadFolder);
        let radar = null;
        if (settings.sendRadar) {
          try {
            radar = await sendToRadar(jobs, settings);
          } catch (error) {
            sendResponse({ ok: false, error: `Arquivos processados, mas o Radar falhou: ${error.message}` });
            return;
          }
        }
        sendResponse({ ok: true, total: accumulated.length, matched: jobs.length, radar });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || 'Falha ao exportar.' });
      }
    })();
    return true;
  }
});
