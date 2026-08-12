importScripts('stacks.js');

/**
 * background.js — service worker da extensão.
 *
 * Há dois modos de coleta:
 *
 * 1) Manual (COLLECT_CURRENT_PAGE): a pessoa navega até a página que quer
 *    (preservando filtros de estado/cidade/cargo como preferir) e clica em
 *    "Coletar esta página". Funciona com qualquer filtro.
 *
 * 2) Automático (AUTO_COLLECT_ALL, via porta): avança sozinho por todas as
 *    páginas do resultado usando o mini-formulário nativo "Pular para a
 *    página" do APinfo (pkey/tcv gerados pelo servidor). Só funciona SEM
 *    filtro nenhum marcado — reenviar o formulário principal de busca com
 *    o campo de página alterado à mão quebra o resultado (testado: a busca
 *    "zera" para 1 vaga encontrada). Por isso o modo automático é para
 *    trazer o total geral de vagas de uma vez; filtro por stack ainda pode
 *    ser aplicado depois, na exportação.
 *
 * Ambos acumulam em chrome.storage.session até a pessoa exportar ou limpar.
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
  const cols = ['codigo_apinfo', 'titulo', 'empresa', 'local', 'data_publicacao', 'descricao', 'stack', 'link', 'link_candidatura', 'email_contato', 'assunto_email', 'coletado_em', 'pagina'];
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
    // url é a referência estável (busca por código) — não abre a vaga
    // diretamente, mas nunca muda, então é o que o Radar usa para
    // deduplicar. applyUrl é o link de candidatura com token de sessão:
    // abre a vaga/candidatura de fato, mas pode expirar — por isso fica
    // de fora do identificador único da vaga.
    url: job.link,
    applyUrl: job.link_candidatura || undefined,
    // Contato capturado manualmente (botão dedicado, após login feito pela
    // própria pessoa no site). Ausente na maioria das vagas — só existe
    // quando alguém clicou em "Capturar contato" naquela vaga específica.
    contactEmail: job.email_contato || undefined,
    contactSubject: job.assunto_email || undefined,
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

/**
 * Injeta page-collector.js na aba do APinfo já identificada pelo chamador
 * (dashboard.js ou popup.js) e devolve o resultado bruto (sem filtro de
 * stack ainda). Não tenta redescobrir "a aba ativa": o tabId recebido já é
 * a aba certa — reconsultar por foco reintroduziria o mesmo bug em que o
 * painel (que está em foco no momento do clique) era confundido com a aba
 * de resultados do APinfo em segundo plano.
 */
async function collectActiveTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url || !/^https:\/\/www\.apinfo\.com\//.test(tab.url)) {
    throw new Error('Abra uma página de resultados do APinfo antes de coletar.');
  }
  const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-collector.js'] });
  return result[0]?.result || { jobs: [], totalResults: 0, currentPage: 1, totalPages: 1 };
}

/**
 * Captura o contato (empresa/email/assunto) já renderizado na aba do APinfo
 * indicada. A pessoa precisa ter feito login (CPF e senha, na própria tela
 * do site) e estar na página que mostra "Empresa"/"Email" ANTES de clicar no
 * botão que dispara isto — a extensão nunca vê nem preenche credenciais,
 * só lê texto já visível na página no momento do clique.
 */
async function collectContact(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url || !/^https:\/\/www\.apinfo\.com\//.test(tab.url)) {
    throw new Error('Abra a página de contato da vaga no APinfo antes de capturar.');
  }
  const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['contact-collector.js'] });
  const outcome = result[0]?.result;
  if (!outcome?.ok) throw new Error(outcome?.error || 'Não foi possível capturar o contato desta página.');
  return outcome;
}

/**
 * Submete o mini-formulário nativo "Pular para a página" do APinfo, distinto
 * do formulário principal de busca (~165 campos). Esse mini-form já vem
 * preenchido pelo servidor com os campos pkey (token) e tcv (total de
 * resultados da busca atual) corretos — usar ESSE form, alterando só o
 * campo pag, é o que preserva o resultado. Reconstruir o form principal com
 * pag alterado à mão quebra a busca (testado: retorna 1 vaga encontrada).
 *
 * Por isso a coleta automática só funciona SEM filtro nenhum marcado — é o
 * modo que o usuário escolheu usar.
 *
 * Passa targetPage via `args` porque `func` (diferente de `files`) aceita
 * argumentos — não precisamos de uma variável global intermediária.
 */
function submitPagingForm(targetPage) {
  const forms = [...document.querySelectorAll('form')];
  const pagForm = forms.find((f) => f.textContent.includes('Pular para a página'));
  if (!pagForm) return { ok: false, error: 'Controle de paginação não encontrado nesta página.' };

  const pagInput = pagForm.querySelector('input[name="pag"]');
  if (!pagInput) return { ok: false, error: 'Campo de página não encontrado no formulário de paginação.' };

  pagInput.value = String(targetPage);
  pagForm.submit();
  return { ok: true, submittedPage: targetPage };
}

async function advanceToPage(tabId, targetPage) {
  // Começa a observar ANTES do form.submit(): a resposta do APinfo é rápida
  // e o evento de carregamento podia acontecer entre submit e waitForTabLoad.
  const loading = waitForTabLoad(tabId);
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: submitPagingForm,
    args: [targetPage],
  });
  const outcome = result[0]?.result;
  if (!outcome?.ok) throw new Error(outcome?.error || 'Falha ao avançar de página.');
  await loading;
  return outcome;
}

async function waitForExpectedPage(tabId, targetPage, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await collectActiveTab(tabId).catch(() => null);
    if (current?.currentPage === targetPage) return current;
    await sleep(400);
  }
  throw new Error(`A APinfo não abriu a página ${targetPage}. A coleta foi interrompida para não exportar dados incompletos.`);
}

/** Espera a aba terminar de carregar (status 'complete') após um form.submit(). */
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('A página demorou demais para carregar.'));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Textos que indicam que o APinfo aplicou algum limite de consultas na sessão. */
const RATE_LIMIT_PATTERNS = [/limite.{0,20}consulta/i, /limite.{0,20}esgotad/i, /muitas consultas/i, /tente novamente mais tarde/i];

function looksRateLimited(pageText) {
  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(pageText || ''));
}

/**
 * Coleta automática de várias páginas em sequência, sem filtro. Delay entre
 * páginas e um teto de páginas por execução evitam martelar o servidor;
 * `looksRateLimited` interrompe cedo se o próprio APinfo sinalizar limite.
 * Progresso é reportado incrementalmente via `onProgress` para a UI poder
 * atualizar "coletando página N de M…" em tempo real.
 */
async function autoCollectAllPages(tabId, { delayMs = 4000, maxPages = 200, selectedPages = null } = {}, onProgress = () => {}) {
  let current = await collectActiveTab(tabId);
  let byCode = new Map();

  const totalPages = current.totalPages || 1;
  const lastPage = Math.min(totalPages, maxPages);
  const requestedPages = selectedPages?.length
    ? [...new Set(selectedPages)].filter((page) => page >= 1 && page <= lastPage).sort((a, b) => a - b)
    : null;
  const pagesToCollect = requestedPages || Array.from(
    { length: Math.max(0, lastPage - (current.currentPage || 1) + 1) },
    (_, index) => (current.currentPage || 1) + index,
  );
  if (!pagesToCollect.length) throw new Error(`Nenhuma página selecionada existe nesta busca, que possui ${totalPages} página(s).`);

  let stoppedReason = null;
  for (let index = 0; index < pagesToCollect.length; index++) {
    const page = pagesToCollect[index];
    if (current.currentPage !== page) {
      if (index > 0 || byCode.size) await sleep(delayMs);
      await advanceToPage(tabId, page);
      await sleep(800); // pequena folga extra após 'complete' para o DOM assentar
      current = await waitForExpectedPage(tabId, page);
    }

    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const bodyText = await chrome.scripting
      .executeScript({ target: { tabId }, func: () => document.body?.innerText || '' })
      .then((r) => r[0]?.result || '')
      .catch(() => '');

    if (looksRateLimited(bodyText)) {
      stoppedReason = 'O APinfo sinalizou limite de consultas. Coleta interrompida — tente retomar mais tarde.';
      break;
    }

    const jobs = current.jobs || [];
    if (!jobs.length && !tab) {
      stoppedReason = 'A aba do APinfo foi fechada ou navegou para outro lugar.';
      break;
    }
    for (const job of jobs) byCode.set(job.codigo_apinfo, job);

    onProgress({ currentPage: page, totalPages, totalResults: current.totalResults, collected: byCode.size, stopped: false });
  }

  return { jobs: [...byCode.values()], stoppedReason, lastPageReached: current.currentPage || pagesToCollect.at(-1) };
}

/** Acumula vagas coletadas entre chamadas, deduplicadas por código da vaga. */
async function getAccumulated() {
  const { apinfoAccumulated } = await chrome.storage.session.get('apinfoAccumulated');
  return apinfoAccumulated || [];
}
async function setAccumulated(items) {
  await chrome.storage.session.set({ apinfoAccumulated: items });
}

/** Contatos capturados manualmente, um por código de vaga (chave = codigo_apinfo). */
async function getContacts() {
  const { apinfoContacts } = await chrome.storage.session.get('apinfoContacts');
  return apinfoContacts || {};
}
async function setContacts(map) {
  await chrome.storage.session.set({ apinfoContacts: map });
}

/**
 * Acha a aba do APinfo mais recentemente usada. Usada pela ponte com o
 * Radar (radar-bridge.js → background.js), onde não há um tabId explícito
 * vindo de quem clicou — diferente do painel da própria extensão, que já
 * roda na aba/janela certa e identifica o tabId antes de pedir a captura.
 * Por isso CAPTURE_CONTACT_FOR_RADAR sempre confere o código da vaga
 * capturada contra o código pedido, depois de achar a aba por aqui.
 */
async function findMostRecentApinfoTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.apinfo.com/*' });
  if (!tabs.length) return null;
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0];
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CAPTURE_CONTACT_FOR_RADAR') {
    (async () => {
      try {
        const tab = await findMostRecentApinfoTab();
        if (!tab) {
          throw new Error('Nenhuma aba do APinfo encontrada. Clique em "Candidatar" para abrir a vaga, faça login e volte aqui.');
        }
        const contact = await collectContact(tab.id);

        // Segurança: confirma que a aba do APinfo aberta é da MESMA vaga
        // que o Radar pediu — evita salvar o contato errado numa vaga
        // diferente se houver mais de uma aba do APinfo aberta ao mesmo
        // tempo (ex.: a pessoa navegando duas vagas em paralelo).
        if (message.externalId && contact.codigo !== String(message.externalId)) {
          throw new Error(
            `A aba aberta do APinfo mostra a vaga ${contact.codigo}, mas esta é a vaga ${message.externalId}. Abra a vaga certa (botão Candidatar) e tente de novo.`,
          );
        }

        const contacts = await getContacts();
        contacts[contact.codigo] = contact;
        await setContacts(contacts);

        sendResponse({ ok: true, email: contact.email, assunto: contact.assunto, empresa: contact.empresa });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || 'Falha ao capturar o contato desta vaga.' });
      }
    })();
    return true;
  }

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

  if (message?.type === 'COLLECT_CONTACT') {
    (async () => {
      try {
        const tabId = message.tabId || sender.tab?.id;
        if (!tabId) throw new Error('Nenhuma aba ativa identificada.');
        const contact = await collectContact(tabId);

        const contacts = await getContacts();
        contacts[contact.codigo] = contact;
        await setContacts(contacts);

        sendResponse({ ok: true, contact, totalContacts: Object.keys(contacts).length });
      } catch (error) {
        sendResponse({ ok: false, error: error.message || 'Falha ao capturar o contato desta vaga.' });
      }
    })();
    return true;
  }

  if (message?.type === 'GET_CONTACTS') {
    (async () => {
      const contacts = await getContacts();
      sendResponse({ ok: true, items: contacts });
    })();
    return true;
  }

  if (message?.type === 'CLEAR_CONTACTS') {
    (async () => {
      await setContacts({});
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === 'EXPORT_ACCUMULATED') {
    (async () => {
      try {
        const accumulated = await getAccumulated();
        const contacts = await getContacts();
        const withContacts = accumulated.map((job) => {
          const contact = contacts[job.codigo_apinfo];
          if (!contact) return job;
          return { ...job, email_contato: contact.email, assunto_email: contact.assunto };
        });
        const settings = message.settings || {};
        const jobs = applyStackFilter(withContacts, settings);
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

/**
 * AUTO_COLLECT_ALL roda via porta (chrome.runtime.connect), não via
 * sendMessage: a coleta de todas as páginas leva minutos, e uma porta
 * permite emitir eventos de progresso incrementais ("página 15 de 115…")
 * enquanto o loop roda, em vez de um único request/response no final.
 *
 * Mensagens do painel → background: { type: 'START', tabId }, { type: 'CANCEL' }
 * Mensagens do background → painel: { type: 'PROGRESS', ... }, { type: 'DONE', ... }, { type: 'ERROR', error }
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'apinfo-auto-collect') return;

  let cancelled = false;
  port.onDisconnect.addListener(() => {
    cancelled = true;
  });

  port.onMessage.addListener((message) => {
    if (message?.type === 'CANCEL') {
      cancelled = true;
      return;
    }
    if (message?.type !== 'START') return;

    (async () => {
      try {
        const tabId = message.tabId;
        if (!tabId) throw new Error('Nenhuma aba do APinfo identificada.');

        const result = await autoCollectAllPages(
          tabId,
          { delayMs: message.delayMs || 4000, maxPages: message.maxPages || 200, selectedPages: message.selectedPages || null },
          (progress) => {
            if (cancelled) return;
            try {
              port.postMessage({ type: 'PROGRESS', ...progress });
            } catch {
              /* porta pode já ter sido fechada pelo painel */
            }
          },
        );

        if (cancelled) return;

        const current = await getAccumulated();
        const byCode = new Map(current.map((job) => [job.codigo_apinfo, job]));
        let added = 0;
        for (const job of result.jobs) {
          if (!byCode.has(job.codigo_apinfo)) added++;
          byCode.set(job.codigo_apinfo, job);
        }
        const accumulated = [...byCode.values()];
        await setAccumulated(accumulated);

        port.postMessage({
          ok: true,
          type: 'DONE',
          collected: result.jobs.length,
          added,
          totalAccumulated: accumulated.length,
          lastPageReached: result.lastPageReached,
          stoppedReason: result.stoppedReason || null,
        });
      } catch (error) {
        if (cancelled) return;
        try {
          port.postMessage({ ok: false, type: 'ERROR', error: error.message || 'Falha na coleta automática.' });
        } catch {
          /* porta fechada */
        }
      }
    })();
  });
});
