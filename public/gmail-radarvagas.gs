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

// Executa manualmente ou por gatilho. Nunca envia mensagens: apenas cria ou
// reaproveita rascunhos que já foram aprovados e enfileirados pelo Radar.
function criarRascunhosRadar() {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const response = UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post', contentType:'application/json', headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'prepare',limit:10}), muteHttpExceptions:true
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
      confirmarRascunhoRadar(secret, item.outboxId, draft.getId());
    } catch (error) {
      registrarFalhaRascunhoRadar(secret, item.outboxId, String(error));
    }
  });
  console.log(`Rascunhos processados: ${(payload.drafts || []).length}. Nenhum e-mail foi enviado.`);
}

// Agenda somente a criação de rascunhos pendentes já aprovados pelo Radar.
// O horário padrão é 9h; a função não envia e-mails e pode ser removida a
// qualquer momento com removerAgendamentoRascunhosRadar().
function instalarAgendamentoRascunhosRadar() {
  removerAgendamentoRascunhosRadar();
  ScriptApp.newTrigger('executarTriagemDiariaERascunhos').timeBased().everyDays(1).atHour(9).create();
}

function removerAgendamentoRascunhosRadar() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'executarTriagemDiariaERascunhos')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function executarTriagemDiariaERascunhos() {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const response = UrlFetchApp.fetch(`${radarUrl()}/api/triage/run`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({trigger:'schedule',batchSize:100,aiMode:'off',createDrafts:false}),muteHttpExceptions:true
  });
  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
  criarRascunhosRadar();
}

function confirmarRascunhoRadar(secret, outboxId, gmailDraftId) {
  return UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'confirm',outboxId:outboxId,gmailDraftId:gmailDraftId}),muteHttpExceptions:true
  });
}

function registrarFalhaRascunhoRadar(secret, outboxId, error) {
  return UrlFetchApp.fetch(`${radarUrl()}/api/cron/drafts`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'fail',outboxId:outboxId,error:error}),muteHttpExceptions:true
  });
}
