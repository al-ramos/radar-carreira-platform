function radarUrl() {
  const value = PropertiesService.getScriptProperties().getProperty('RADAR_URL');
  if (!value) throw new Error('Configure RADAR_URL com o endereço publicado do Radar Carreira.');
  return value.replace(/\/+$/, '');
}

function importarRadarVagas() {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const label = GmailApp.getUserLabelByName('RadarVagas');
  if (!label) throw new Error('Etiqueta RadarVagas não encontrada.');
  const since = Date.now() - 48 * 60 * 60 * 1000;
  const messages = label.getThreads(0, 100).flatMap(thread => thread.getMessages())
    .filter(message => message.getDate().getTime() >= since)
    .map(message => ({id:message.getId(),from:message.getFrom(),subject:message.getSubject(),date:message.getDate().toISOString(),body:message.getPlainBody()}));
  const response = UrlFetchApp.fetch(`${radarUrl()}/api/cron/email-import`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({label:'RadarVagas',messages}),muteHttpExceptions:true
  });
  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
  console.log(response.getContentText());
  enviarResumoDiario();
}

function enviarResumoDiario() {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const prepare = UrlFetchApp.fetch(`${radarUrl()}/api/cron/digest`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'prepare'}),muteHttpExceptions:true
  });
  if (prepare.getResponseCode() >= 300) throw new Error(prepare.getContentText());
  const digest = JSON.parse(prepare.getContentText());
  if (!digest.send) { console.log(digest.reason); return; }
  GmailApp.sendEmail(digest.to, digest.subject, digest.text, {htmlBody:digest.html,name:'Radar Carreira'});
  const confirm = UrlFetchApp.fetch(`${radarUrl()}/api/cron/digest`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'confirm',deliveryId:digest.deliveryId}),muteHttpExceptions:true
  });
  if (confirm.getResponseCode() >= 300) console.warn(confirm.getContentText());
}

function instalarColetaDiaria() {
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'importarRadarVagas').forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('importarRadarVagas').timeBased().everyDays(1).atHour(8).create();
}

const RADAR_DRAFT_CONNECTOR_VERSION = 'radar-drafts-v2';

// Executa manualmente ou por gatilho. Nunca envia mensagens: apenas cria ou
// reaproveita rascunhos que já foram aprovados e enfileirados pelo Radar.
function criarRascunhosRadar(options) {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const outboxIds = options && Array.isArray(options.outboxIds) ? options.outboxIds.filter(id => typeof id === 'string' && id) : null;
  let processed = 0, scanned = 0;
  // 10 lotes de 10 cobrem com margem a rotina diária e preservam o limite
  // por chamada. Itens que deixaram de ser seguros são cancelados pelo Radar.
  for (let batch = 0; batch < 10; batch += 1) {
    const response = UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
      method:'post', contentType:'application/json', headers:{Authorization:`Bearer ${secret}`},
      payload:JSON.stringify({action:'prepare',limit:outboxIds ? Math.min(20, outboxIds.length) : 10,retryFailed:true,connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION,outboxIds:outboxIds || undefined}), muteHttpExceptions:true
    });
    if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
    const payload = JSON.parse(response.getContentText());
    (payload.drafts || []).forEach(item => {
      try {
        const existing = GmailApp.getDrafts().find(draft => {
          const message = draft.getMessage();
          return message.getTo().toLowerCase() === item.to.toLowerCase() && message.getSubject() === item.subject;
        });
        const draft = existing || GmailApp.createDraft(item.to, item.subject, item.body);
        const confirm = confirmarRascunhoRadar(secret, item.outboxId, draft.getId(), item.subject);
        if (confirm.getResponseCode() >= 300) throw new Error(confirm.getContentText());
        processed += 1;
      } catch (error) {
        registrarFalhaRascunhoRadar(secret, item.outboxId, String(error));
      }
    });
    scanned += payload.scanned || 0;
    if (!payload.hasMore) break;
  }
  console.log(`Rascunhos processados: ${processed}; itens verificados: ${scanned}. Nenhum e-mail foi enviado.`);
  return { processed: processed, scanned: scanned };
}

// Web App autenticado pelo mesmo segredo do conector. O Radar chama somente
// ações avulsas: criar rascunho ou confirmar um envio já realizado.
function doPost(event) {
  try {
    const payload = JSON.parse(event && event.postData && event.postData.contents || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
    if (!secret || payload.token !== secret) return responderWebhookRadar({ ok:false, error:'Não autorizado' });
    if (!Array.isArray(payload.outboxIds) || !payload.outboxIds.length) return responderWebhookRadar({ ok:false, error:'Selecione ao menos um rascunho.' });
    if (payload.action === 'prioritizeDrafts') {
      const result = criarRascunhosRadar({ outboxIds: payload.outboxIds });
      return responderWebhookRadar({ ok:true, created: result.processed, scanned: result.scanned });
    }
    if (payload.action === 'reconcileSent') return responderWebhookRadar({ ok:true, confirmed: reconciliarEnviosManuaisRadar({ outboxIds: payload.outboxIds }));
    return responderWebhookRadar({ ok:false, error:'Ação de prioridade inválida' });
  } catch (error) {
    return responderWebhookRadar({ ok:false, error:String(error) });
  }
}

function responderWebhookRadar(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

// Diagnóstico seguro antes de uma operação manual: confirma URL, credencial e
// versão do conector sem criar ou enviar nenhum e-mail.
function verificarConectorRascunhosRadar() {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const response = UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post', contentType:'application/json', headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'health',connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION}), muteHttpExceptions:true
  });
  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
  const payload = JSON.parse(response.getContentText());
  if (payload.connectorVersion !== RADAR_DRAFT_CONNECTOR_VERSION) throw new Error('Versão do conector não corresponde ao Radar publicado.');
  console.log('Conector de rascunhos verificado. Nenhum e-mail foi criado ou enviado.');
}

// Remove acionadores legados caso algum tenha sido criado em versões anteriores.
// A criação de rascunhos agora é exclusivamente manual.
function removerAgendamentoRascunhosRadar() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => ['executarTriagemDiariaERascunhos', 'executarRascunhosPendentesRadar'].includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function executarRascunhosPendentesRadar() {
  criarRascunhosRadar();
  reconciliarEnviosManuaisRadar();
}

function confirmarRascunhoRadar(secret, outboxId, gmailDraftId, subject) {
  return UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'confirm',outboxId:outboxId,gmailDraftId:gmailDraftId,subject:subject}),muteHttpExceptions:true
  });
}

function registrarFalhaRascunhoRadar(secret, outboxId, error) {
  return UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'fail',outboxId:outboxId,error:error}),muteHttpExceptions:true
  });
}

// Verifica somente mensagens que já estão em "Enviados". Não cria, altera ou
// envia e-mails. O Radar fornece os candidatos exatos; a confirmação exige
// destinatário, assunto e data posteriores ao rascunho para evitar falsos
// positivos e continua idempotente pelo identificador da mensagem Gmail.
function reconciliarEnviosManuaisRadar(options) {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const response = UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'sentCandidates',limit:options && options.outboxIds ? options.outboxIds.length : 100,outboxIds:options && options.outboxIds,connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION}),muteHttpExceptions:true
  });
  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
  const payload = JSON.parse(response.getContentText());
  let confirmed = 0;
  (payload.candidates || []).forEach(candidate => {
    const message = encontrarMensagemEnviadaRadar(candidate);
    if (!message) return;
    const confirmation = UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
      method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
      payload:JSON.stringify({
        action:'reconcileSent',outboxId:candidate.outboxId,gmailSentId:message.getId(),
        to:candidate.to,subject:candidate.subject,sentAt:message.getDate().toISOString(),
        connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION
      }),muteHttpExceptions:true
    });
    if (confirmation.getResponseCode() >= 300) {
      console.warn(`Não foi possível confirmar envio de ${candidate.outboxId}: ${confirmation.getContentText()}`);
      return;
    }
    confirmed += 1;
  });
  console.log(`Envios manuais confirmados: ${confirmed}. Nenhum e-mail foi criado ou enviado nesta etapa.`);
  return confirmed;
}

function encontrarMensagemEnviadaRadar(candidate) {
  const escapedSubject = String(candidate.subject || '').replace(/["\\]/g, ' ');
  const since = new Date(candidate.draftedAt).getTime() - 60 * 1000;
  const query = `in:sent to:${candidate.to} subject:"${escapedSubject}"`;
  const messages = GmailApp.search(query, 0, 20).flatMap(thread => thread.getMessages());
  return messages
    .filter(message => message.getDate().getTime() >= since)
    .filter(message => message.getSubject() === candidate.subject)
    .filter(message => extrairDestinatarioUnicoRadar(message.getTo()) === candidate.to.toLowerCase())
    .sort((left, right) => right.getDate().getTime() - left.getDate().getTime())[0] || null;
}

function extrairDestinatarioUnicoRadar(value) {
  const matches = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const addresses = [...new Set(matches.map(address => address.toLowerCase()))];
  return addresses.length === 1 ? addresses[0] : null;
}
