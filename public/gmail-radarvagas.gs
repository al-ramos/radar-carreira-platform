const RADAR_URL = 'https://radar-carreira-platform.jazzy-siren-4604.chatgpt.site';

function importarRadarVagas() {
  const secret = PropertiesService.getScriptProperties().getProperty('RADAR_SECRET');
  if (!secret) throw new Error('Configure RADAR_SECRET nas propriedades do script.');
  const label = GmailApp.getUserLabelByName('RadarVagas');
  if (!label) throw new Error('Etiqueta RadarVagas não encontrada.');
  const since = Date.now() - 48 * 60 * 60 * 1000;
  const messages = label.getThreads(0, 100).flatMap(thread => thread.getMessages())
    .filter(message => message.getDate().getTime() >= since)
    .map(message => ({id:message.getId(),from:message.getFrom(),subject:message.getSubject(),date:message.getDate().toISOString(),body:message.getPlainBody()}));
  const response = UrlFetchApp.fetch(`${RADAR_URL}/api/cron/email-import`, {
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
  const prepare = UrlFetchApp.fetch(`${RADAR_URL}/api/cron/digest`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'prepare'}),muteHttpExceptions:true
  });
  if (prepare.getResponseCode() >= 300) throw new Error(prepare.getContentText());
  const digest = JSON.parse(prepare.getContentText());
  if (!digest.send) { console.log(digest.reason); return; }
  GmailApp.sendEmail(digest.to, digest.subject, digest.text, {htmlBody:digest.html,name:'Radar Carreira'});
  const confirm = UrlFetchApp.fetch(`${RADAR_URL}/api/cron/digest`, {
    method:'post',contentType:'application/json',headers:{Authorization:`Bearer ${secret}`},
    payload:JSON.stringify({action:'confirm',deliveryId:digest.deliveryId}),muteHttpExceptions:true
  });
  if (confirm.getResponseCode() >= 300) console.warn(confirm.getContentText());
}

function instalarColetaDiaria() {
  ScriptApp.getProjectTriggers().filter(trigger => trigger.getHandlerFunction() === 'importarRadarVagas').forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('importarRadarVagas').timeBased().everyDays(1).atHour(8).create();
}
