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

const RADAR_DRAFT_CONNECTOR_VERSION = 'radar-drafts-v4-sent-first';
const RADAR_SENT_RECONCILIATION_HANDLER = 'reconciliarEnviosAgendadosRadar';
const RADAR_DRAFT_RECOVERY_HANDLER = 'executarRascunhosPendentesRadar';
const RADAR_CV_FILE_PROPERTY = 'RADAR_CV_FILE_ID';
const RADAR_CV_FILE_NAME = 'Alex Ramos Back.pdf';
const RADAR_DEFAULT_SIGNATURE = [
  'AMR Solution — Workflow Management & Process Automation',
  '✉ contato@amrsolution.com.br',
  '📱 (11) 95285-2634 ● WhatsApp',
  '📍 Mogi das Cruzes, SP — Brasil',
  'LinkedIn',
  'GitHub',
].join('\n');

function escapeHtmlRadar(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// O currículo permanece privado no Drive da conta que executa o Apps Script.
// Não é copiado para o Radar nem fica exposto em uma URL pública.
function optionsComCurriculoEAssinaturaRadar(body) {
  const fileId = PropertiesService.getScriptProperties().getProperty(RADAR_CV_FILE_PROPERTY);
  if (!fileId) throw new Error(`Configure ${RADAR_CV_FILE_PROPERTY} nas propriedades do Apps Script antes de criar rascunhos.`);
  const cv = DriveApp.getFileById(fileId);
  if (cv.getMimeType() !== MimeType.PDF) throw new Error(`O arquivo configurado em ${RADAR_CV_FILE_PROPERTY} deve ser um PDF.`);
  const text = `${body.trim()}\n\n${RADAR_DEFAULT_SIGNATURE}`;
  return {
    text,
    options: {
      htmlBody: escapeHtmlRadar(text).replace(/\n/g, '<br>'),
      attachments: [cv.getBlob().setName(RADAR_CV_FILE_NAME)],
      name: 'AMR Solution',
    },
  };
}

// Cria ou reaproveita rascunhos que já foram aprovados e enfileirados pelo
// Radar. Quando autoSend=true, envia o rascunho somente depois de o Radar
// confirmar a vinculação do ID Gmail à vaga; isso impede envio sem outbox.
function criarRascunhosRadar(options) {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const outboxIds = options && Array.isArray(options.outboxIds) ? options.outboxIds.filter(id => typeof id === 'string' && id) : null;
  const autoSend = Boolean(options && options.autoSend);
  let processed = 0, sent = 0, reconciled = 0, scanned = 0;
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
        // A pasta Enviados é consultada antes de criar ou enviar qualquer
        // mensagem. Uma correspondência exata vira registro no Radar e
        // encerra este item sem duplicar a candidatura.
        const alreadySent = encontrarMensagemEnviadaRadar(item);
        if (alreadySent) {
          const confirmation = registrarEnvioConciliadoRadar(secret, item, alreadySent);
          if (confirmation.getResponseCode() >= 300) throw new Error(confirmation.getContentText());
          reconciled += 1;
          return;
        }
        const content = optionsComCurriculoEAssinaturaRadar(item.body);
        const existing = GmailApp.getDrafts().find(draft => {
          const message = draft.getMessage();
          return message.getTo().toLowerCase() === item.to.toLowerCase() && message.getSubject() === item.subject;
        });
        // update substitui um rascunho já existente pela versão com currículo
        // e assinatura, evitando duplicidade e corrigindo rascunhos antigos.
        const draft = existing
          ? existing.update(item.to, item.subject, content.text, content.options)
          : GmailApp.createDraft(item.to, item.subject, content.text, content.options);
        const gmailThreadId = draft.getMessage().getThread().getId();
        const confirm = confirmarRascunhoRadar(secret, item.outboxId, draft.getId(), item.subject, gmailThreadId);
        if (confirm.getResponseCode() >= 300) throw new Error(confirm.getContentText());
        processed += 1;
        if (autoSend && item.autoSendAuthorized === true) {
          const sentMessage = draft.send();
          const sentConfirmation = confirmarEnvioAutomaticoRadar(secret, item, sentMessage);
          if (sentConfirmation.getResponseCode() >= 300) {
            throw new Error(`Mensagem enviada, mas o Radar ainda não confirmou o envio: ${sentConfirmation.getContentText()}`);
          }
          sent += 1;
        }
      } catch (error) {
        registrarFalhaRascunhoRadar(secret, item.outboxId, String(error));
      }
    });
    scanned += payload.scanned || 0;
    if (!payload.hasMore) break;
  }
  console.log(`Rascunhos processados: ${processed}; e-mails enviados automaticamente: ${sent}; envios anteriores conciliados sem reenvio: ${reconciled}; itens verificados: ${scanned}.`);
  return { processed: processed, sent: sent, reconciled: reconciled, scanned: scanned };
}

// Web App autenticado pelo mesmo segredo do conector. A ação prioritizeDrafts
// recebeu autorização explícita para criar e enviar novas candidaturas
// elegíveis; reconcileSent continua apenas conferindo envios já realizados.
function doPost(event) {
  try {
    const payload = JSON.parse(event && event.postData && event.postData.contents || '{}');
    const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
    if (!secret || payload.token !== secret) return responderWebhookRadar({ ok:false, error:'Não autorizado' });
    if (payload.action === 'health') return responderWebhookRadar({ ok:true, connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION });
    if (!Array.isArray(payload.outboxIds) || !payload.outboxIds.length) return responderWebhookRadar({ ok:false, error:'Selecione ao menos um rascunho.' });
    if (payload.action === 'prioritizeDrafts') {
      const result = criarRascunhosRadar({ outboxIds: payload.outboxIds, autoSend:true });
      return responderWebhookRadar({ ok:true, created: result.processed, sent: result.sent, reconciled: result.reconciled, scanned: result.scanned });
    }
    if (payload.action === 'reconcileSent') return responderWebhookRadar({ ok:true, confirmed: reconciliarEnviosManuaisRadar({ outboxIds: payload.outboxIds }) });
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

// A recuperação automática é a segunda camada de segurança: a chamada do
// Radar continua sendo imediata; este gatilho retoma candidaturas elegíveis
// que ainda não chegaram ao estado sent e reconcilia a outbox.
function instalarAutomacaoRascunhosRadar() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === RADAR_DRAFT_RECOVERY_HANDLER)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger(RADAR_DRAFT_RECOVERY_HANDLER).timeBased().everyMinutes(5).create();
  console.log('Recuperação automática instalada: a cada 5 minutos, com envio das novas candidaturas elegíveis.');
}

// Remove apenas o gatilho de recuperação de rascunhos; a criação imediata via
// webhook continua disponível enquanto o Web App estiver publicado.
function removerAgendamentoRascunhosRadar() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => ['executarTriagemDiariaERascunhos', RADAR_DRAFT_RECOVERY_HANDLER].includes(trigger.getHandlerFunction()))
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function executarRascunhosPendentesRadar() {
  const missing = reconciliarRascunhosRadar();
  const automatic = criarRascunhosRadar({ autoSend:true });
  const sent = reconciliarEnviosManuaisRadar();
  console.log(`Recuperação concluída: ${missing} rascunho(s) ausente(s), ${automatic.sent} e-mail(s) enviado(s) automaticamente e ${sent} envio(s) reconciliado(s).`);
}

// Confere os IDs de rascunhos que o Radar já recebeu do Gmail. Um item ausente
// volta a "failed" no Radar e será recriado por criarRascunhosRadar logo em
// seguida. Não altera rascunhos existentes e nunca envia e-mails.
function reconciliarRascunhosRadar() {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const response = UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post', contentType:'application/json', headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'draftCandidates',limit:100,connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION}), muteHttpExceptions:true
  });
  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
  const payload = JSON.parse(response.getContentText());
  const existingIds = new Set(GmailApp.getDrafts().map(draft => draft.getId()));
  let missing = 0;
  (payload.candidates || []).forEach(item => {
    if (existingIds.has(item.gmailDraftId)) return;
    const result = UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
      method:'post', contentType:'application/json', headers:{Authorization:`Bearer ${secret}`},
      payload:JSON.stringify({action:'missing',outboxId:item.outboxId,gmailDraftId:item.gmailDraftId,connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION}), muteHttpExceptions:true
    });
    if (result.getResponseCode() >= 300) throw new Error(result.getContentText());
    missing += 1;
  });
  return missing;
}

// Instala uma verificação leve e independente da criação de rascunhos. Ela
// lê apenas a pasta Enviados e atualiza o Radar quando encontra evidência de
// uma mensagem já enviada manualmente; nunca cria ou envia e-mails.
function instalarVerificacaoEnviosRadar() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === RADAR_SENT_RECONCILIATION_HANDLER)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger(RADAR_SENT_RECONCILIATION_HANDLER).timeBased().everyMinutes(15).create();
  console.log('Verificação de envios instalada: a cada 15 minutos. Nenhum e-mail será criado ou enviado.');
}

function removerVerificacaoEnviosRadar() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === RADAR_SENT_RECONCILIATION_HANDLER)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  console.log('Verificação automática de envios removida.');
}

function reconciliarEnviosAgendadosRadar() {
  const confirmed = reconciliarEnviosManuaisRadar();
  console.log(`Verificação automática concluída: ${confirmed} envio(s) confirmado(s). Nenhum e-mail foi criado ou enviado.`);
  return confirmed;
}

function confirmarRascunhoRadar(secret, outboxId, gmailDraftId, subject, gmailThreadId) {
  return UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'confirm',outboxId:outboxId,gmailDraftId:gmailDraftId,gmailThreadId:gmailThreadId,subject:subject}),muteHttpExceptions:true
  });
}

function confirmarEnvioAutomaticoRadar(secret, item, message) {
  return UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({
      action:'reconcileSent',outboxId:item.outboxId,gmailSentId:message.getId(),
      to:item.to,subject:message.getSubject(),gmailThreadId:message.getThread().getId(),sentAt:message.getDate().toISOString(),isDraft:message.isDraft(),
      connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION
    }),muteHttpExceptions:true
  });
}

function registrarEnvioConciliadoRadar(secret, candidate, message) {
  return UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({
      action:'reconcileSent',outboxId:candidate.outboxId,gmailSentId:message.getId(),
      to:candidate.to,subject:message.getSubject(),gmailThreadId:candidate.gmailThreadId || null,
      sentAt:message.getDate().toISOString(),isDraft:message.isDraft(),connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION
    }),muteHttpExceptions:true
  });
}

function registrarEnvioNaoLocalizadoRadar(secret, outboxId) {
  return UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'reconcileMissing',outboxId:outboxId,connectorVersion:RADAR_DRAFT_CONNECTOR_VERSION}),muteHttpExceptions:true
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
    if (!message) {
      if (candidate.reconciliationOnly) {
        const missing = registrarEnvioNaoLocalizadoRadar(secret, candidate.outboxId);
        if (missing.getResponseCode() >= 300) console.warn(`Não foi possível encerrar a verificação de ${candidate.outboxId}: ${missing.getContentText()}`);
      }
      return;
    }
    const confirmation = registrarEnvioConciliadoRadar(secret, candidate, message);
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
  const since = new Date(candidate.searchFrom || candidate.draftedAt).getTime() - 24 * 60 * 60 * 1000;
  // Não use a conversa como prova de envio: um rascunho pertence à mesma
  // conversa e seria confundido com mensagem enviada. A busca começa em
  // Enviados e elimina explicitamente qualquer mensagem ainda em rascunho.
  const query = `in:sent to:${candidate.to} subject:"${escapedSubject}"`;
  const messages = GmailApp.search(query, 0, 20).flatMap(thread => thread.getMessages());
  return messages
    .filter(message => !message.isDraft())
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
