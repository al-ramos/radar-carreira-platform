"use client";

import { useEffect, useState } from "react";
import { selectedMaintenanceQuantity } from "../lib/job-maintenance";

type Settings = { collectionEnabled: boolean; emailImportEnabled: boolean; enrichmentEnabled: boolean; scheduledTriageEnabled: boolean; scheduledTriageBatchSize: number; queueDailyOperationBudget: number; manualQueueMessageSize: number; aiReviewChunkSize: number; defaultPeriod: string; defaultMinScore: number; staleAfterDays: number; retentionDays: number };
type JobSummary = { total: number; active: number; possiblyClosed: number; closed: number; archived: number; activeEligibleForArchive: number; archivedEligibleForPurge: number; possiblyClosedEligibleForPurge: number; closedEligibleForPurge: number; viewedEligibleForArchive: number };
type PurgeScope = "archived" | "possibly_closed" | "closed";

const initial: Settings = { collectionEnabled: true, emailImportEnabled: true, enrichmentEnabled: true, scheduledTriageEnabled: false, scheduledTriageBatchSize: 100, queueDailyOperationBudget: 7500, manualQueueMessageSize: 25, aiReviewChunkSize: 10, defaultPeriod: "24", defaultMinScore: 70, staleAfterDays: 7, retentionDays: 180 };
const CONFIRMATION = "EXCLUIR TODAS AS VAGAS";
const formatNumber = (value: number) => value.toLocaleString("pt-BR");
const formatDate = (value: string) => value.split("-").reverse().join("/");
const defaultCutoff = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - 7 * 864e5));

export default function AdminSettings({ isOwner }: { isOwner: boolean }) {
  const [s, setS] = useState(initial);
  const [status, setStatus] = useState("Carregando parâmetros…");
  const [jobs, setJobs] = useState<JobSummary | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [archivedBefore, setArchivedBefore] = useState(defaultCutoff);
  const [viewedBefore, setViewedBefore] = useState(defaultCutoff);
  const [archiveQuantity, setArchiveQuantity] = useState("");
  const [purgeQuantity, setPurgeQuantity] = useState("");
  const [purgeScope, setPurgeScope] = useState<PurgeScope>("archived");
  const [cleaning, setCleaning] = useState(false);
  const [purgingArchived, setPurgingArchived] = useState(false);
  const [archivingViewed, setArchivingViewed] = useState(false);
  const [archivingJobs, setArchivingJobs] = useState(false);

  const summaryUrl = `/api/admin/jobs?archivedBefore=${encodeURIComponent(archivedBefore)}&viewedBefore=${encodeURIComponent(viewedBefore)}`;

  async function refreshSummary() {
    const response = await fetch(summaryUrl);
    const summary = await response.json();
    if (!response.ok) throw new Error(summary.error ?? "Não foi possível consultar os recortes.");
    setJobs(summary);
    return summary as JobSummary;
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/admin/settings"), fetch(summaryUrl)])
      .then(async ([settingsResponse, jobsResponse]) => ({ settingsResponse, jobsResponse, settings: await settingsResponse.json(), summary: await jobsResponse.json() }))
      .then(({ settingsResponse, jobsResponse, settings, summary }) => {
        if (cancelled) return;
        if (!settingsResponse.ok || !jobsResponse.ok) throw new Error();
        setS(settings.settings);
        setJobs(summary);
        setStatus("");
      })
      .catch(() => { if (!cancelled) setStatus("Não foi possível carregar os parâmetros."); });
    return () => { cancelled = true; };
  }, [summaryUrl]);

  const toggle = (key: keyof Settings) => (event: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [key]: event.target.checked });

  async function save() {
    setStatus("Salvando…");
    const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
    setStatus(response.ok ? "Parâmetros salvos e ativos." : "Não foi possível salvar.");
  }

  async function clearJobs() {
    if (confirmation !== CONFIRMATION) { setStatus(`Digite ${CONFIRMATION} para liberar a limpeza.`); return; }
    if (!window.confirm(`Excluir ${formatNumber(jobs?.total ?? 0)} vagas do banco? Esta ação não pode ser desfeita.`)) return;
    setCleaning(true);
    setStatus("Limpando base de vagas…");
    try {
      const response = await fetch("/api/admin/jobs", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true, confirmation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setJobs({ total: 0, active: 0, possiblyClosed: 0, closed: 0, archived: 0, activeEligibleForArchive: 0, archivedEligibleForPurge: 0, possiblyClosedEligibleForPurge: 0, closedEligibleForPurge: 0, viewedEligibleForArchive: 0 });
      setConfirmation("");
      setStatus(`${formatNumber(data.deleted)} vagas removidas. Usuários, perfil, fontes e integrações foram preservados.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível limpar a base.");
    } finally { setCleaning(false); }
  }

  const purgeTotals: Record<PurgeScope, number> = {
    archived: jobs?.archivedEligibleForPurge ?? 0,
    possibly_closed: jobs?.possiblyClosedEligibleForPurge ?? 0,
    closed: jobs?.closedEligibleForPurge ?? 0,
  };
  const purgeLabels: Record<PurgeScope, { singular: string; plural: string }> = { archived: { singular: "arquivada", plural: "arquivadas" }, possibly_closed: { singular: "possivelmente encerrada", plural: "possivelmente encerradas" }, closed: { singular: "encerrada", plural: "encerradas" } };
  const purgeTotal = purgeTotals[purgeScope];
  const selectedPurgeTotal = selectedMaintenanceQuantity(purgeQuantity, purgeTotal);
  const archiveTotal = jobs?.activeEligibleForArchive ?? 0;
  const selectedArchiveTotal = selectedMaintenanceQuantity(archiveQuantity, archiveTotal);
  const purgeLabel = purgeTotal === 1 ? purgeLabels[purgeScope].singular : purgeLabels[purgeScope].plural;
  const purgeDescription = `${formatNumber(selectedPurgeTotal)} ${selectedPurgeTotal === 1 ? "vaga" : "vagas"} ${purgeLabel}`;

  async function purgeInactive() {
    if (!selectedPurgeTotal) return;
    const warning = `Excluir definitivamente ${purgeDescription} ${selectedPurgeTotal === 1 ? "publicada" : "publicadas"} antes de ${formatDate(archivedBefore)}? A exclusão é global e remove triagem, pipeline, rascunhos registrados, eventos e demais dados vinculados. Esta ação não pode ser desfeita.`;
    if (!window.confirm(warning)) return;
    setPurgingArchived(true);
    setStatus("Excluindo o recorte…");
    try {
      const response = await fetch("/api/admin/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "purge_archived_before", status: purgeScope, archivedBefore, quantity: purgeQuantity ? selectedPurgeTotal : undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refreshSummary();
      setStatus(`${formatNumber(data.deleted)} ${data.deleted === 1 ? "vaga" : "vagas"} ${data.deleted === 1 ? purgeLabels[purgeScope].singular : purgeLabels[purgeScope].plural} e todos os dados vinculados foram removidos definitivamente.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível excluir o recorte selecionado.");
    } finally { setPurgingArchived(false); }
  }

  async function archiveActiveJobs() {
    if (!selectedArchiveTotal) return;
    if (!window.confirm(`Arquivar ${formatNumber(selectedArchiveTotal)} ${selectedArchiveTotal === 1 ? "vaga ativa" : "vagas ativas"} publicadas antes de ${formatDate(archivedBefore)}? As mais antigas serão processadas primeiro e nenhum dado vinculado será apagado.`)) return;
    setArchivingJobs(true);
    setStatus("Arquivando o recorte global…");
    try {
      const response = await fetch("/api/admin/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive_active_before", archivedBefore, quantity: archiveQuantity ? selectedArchiveTotal : undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refreshSummary();
      setStatus(`${formatNumber(data.archived)} ${data.archived === 1 ? "vaga ativa foi arquivada" : "vagas ativas foram arquivadas"}. Nenhuma triagem, candidatura ou evidência foi apagada.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível arquivar o recorte global.");
    } finally { setArchivingJobs(false); }
  }

  async function archiveViewed() {
    const viewedTotal = jobs?.viewedEligibleForArchive ?? 0;
    if (!viewedTotal) return;
    if (!window.confirm(`Arquivar ${formatNumber(viewedTotal)} ${viewedTotal === 1 ? "vaga vista" : "vagas vistas"} por você antes de ${formatDate(viewedBefore)}? ${viewedTotal === 1 ? "Ela sairá" : "Elas sairão"} de “Vistas”, não ${viewedTotal === 1 ? "voltará" : "voltarão"} para “Não vistas” e ${viewedTotal === 1 ? "permanecerá" : "permanecerão"} no banco com todo o histórico.`)) return;
    setArchivingViewed(true);
    setStatus("Arquivando as vagas vistas…");
    try {
      const response = await fetch("/api/admin/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "archive_viewed_before", viewedBefore }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await refreshSummary();
      setStatus(`${formatNumber(data.archived)} ${data.archived === 1 ? "vaga saiu" : "vagas saíram"} de “Vistas” e ${data.archived === 1 ? "foi arquivada" : "foram arquivadas"} somente no seu Radar. Nenhuma vaga ou histórico foi apagado.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível arquivar as vagas vistas.");
    } finally { setArchivingViewed(false); }
  }

  return <section className="admin-settings"><div className="admin-heading"><div><p className="eyebrow">ADMINISTRAÇÃO DO PORTAL</p><h3>Parâmetros operacionais</h3></div><span>Somente admin</span></div><div className="switch-grid">
    <label><input type="checkbox" checked={s.collectionEnabled} onChange={toggle("collectionEnabled")} /><span><b>Coleta automática</b><small>Autoriza a rotina diária das fontes.</small></span></label>
    <label><input type="checkbox" checked={s.emailImportEnabled} onChange={toggle("emailImportEnabled")} /><span><b>Importação por e-mail</b><small>Recebe alertas do conector Gmail.</small></span></label>
    <label><input type="checkbox" checked={s.enrichmentEnabled} onChange={toggle("enrichmentEnabled")} /><span><b>Enriquecimento oficial</b><small>Completa descrições por fontes monitoradas.</small></span></label>
    <label><input type="checkbox" checked={s.scheduledTriageEnabled} onChange={toggle("scheduledTriageEnabled")} /><span><b>Triagem agendada</b><small>Avalia por regras e IA ambígua sem intervenção manual.</small></span></label>
    <div className="admin-fixed-policy"><b>Envio automático autorizado</b><small>Toda vaga ✅ com e-mail válido recebe currículo e assinatura, é enviada pelo Gmail e fica registrada na outbox.</small></div></div>
    <div className="profile-grid admin-number-grid"><label>Vagas por triagem agendada<small>De 1 a 1.000 vagas por rodada; continua até concluir as vagas novas.</small><input type="number" min="1" max="1000" value={s.scheduledTriageBatchSize} onChange={e => setS({ ...s, scheduledTriageBatchSize: Number(e.target.value) })} /></label><label>Janela inicial<select value={s.defaultPeriod} onChange={e => setS({ ...s, defaultPeriod: e.target.value })}><option value="24">Últimas 24 horas</option><option value="72">Últimos 3 dias</option><option value="168">Últimos 7 dias</option><option value="all">Todas</option></select></label><label>Score padrão<input type="number" min="0" max="100" value={s.defaultMinScore} onChange={e => setS({ ...s, defaultMinScore: Number(e.target.value) })} /></label><label>Vaga desatualizada após<input type="number" min="1" max="90" value={s.staleAfterDays} onChange={e => setS({ ...s, staleAfterDays: Number(e.target.value) })} /></label><label>Retenção do histórico<input type="number" min="30" max="1095" value={s.retentionDays} onChange={e => setS({ ...s, retentionDays: Number(e.target.value) })} /></label></div>
    <div className="profile-grid admin-number-grid"><label>Limite diário das filas<small>1.000–10.000 operações; 7.500 mantém margem no plano gratuito.</small><input type="number" min="1000" max="10000" value={s.queueDailyOperationBudget} onChange={e => setS({ ...s, queueDailyOperationBudget: Number(e.target.value) })} /></label><label>Vagas por mensagem manual<small>1–100; mais vagas reduzem mensagens.</small><input type="number" min="1" max="100" value={s.manualQueueMessageSize} onChange={e => setS({ ...s, manualQueueMessageSize: Number(e.target.value) })} /></label><label>Vagas por lote de IA<small>1–20; ajuste conforme as descrições.</small><input type="number" min="1" max="20" value={s.aiReviewChunkSize} onChange={e => setS({ ...s, aiReviewChunkSize: Number(e.target.value) })} /></label></div>
    {status && <div className="notice">{status}</div>}<div className="source-actions"><button className="primary" onClick={save}>Salvar parâmetros</button></div>
    {isOwner && <section className="admin-danger-zone"><div><p className="eyebrow">MANUTENÇÃO DA BASE</p><h3>Controle transparente do acervo</h3><p>Escolha entre organizar somente o seu Radar ou apagar vagas inativas do banco. A contagem é recalculada para cada data antes de liberar uma ação.</p></div><a href="/api/admin/backup">↓ Baixar backup JSON antes de excluir</a>
      {jobs ? <dl className="admin-job-summary" aria-label="Situação atual do acervo"><div><dt>Total no banco</dt><dd>{formatNumber(jobs.total)}</dd></div><div><dt>Ativas</dt><dd>{formatNumber(jobs.active)}</dd></div><div><dt>Possivelmente encerradas</dt><dd>{formatNumber(jobs.possiblyClosed)}</dd></div><div><dt>Encerradas</dt><dd>{formatNumber(jobs.closed)}</dd></div><div><dt>Arquivadas</dt><dd>{formatNumber(jobs.archived)}</dd></div></dl> : <p>Consultando a situação do acervo…</p>}
      <section className="admin-maintenance-card admin-personal-maintenance"><h4>Diminuir “Vistas” no meu Radar</h4><p><strong>Alcance pessoal:</strong> move somente suas vagas no estágio “Vista” para “Arquivada”. As vagas permanecem no banco, não reaparecem em “Não vistas” e nenhum histórico, rascunho ou dado de outra pessoa é apagado.</p><label>Arquivar as que foram vistas antes de<input type="date" value={viewedBefore} onChange={event => setViewedBefore(event.target.value)} required /><small>Esta data é a última atualização do estágio “Vista”, não a publicação da vaga.</small></label><div className="admin-impact" aria-live="polite"><strong>{jobs ? formatNumber(jobs.viewedEligibleForArchive) : "…"}</strong><span>{jobs?.viewedEligibleForArchive === 1 ? "vaga vista" : "vagas vistas"} por você entram neste recorte</span></div><button type="button" className="admin-archive-button" disabled={archivingViewed || !viewedBefore || !jobs?.viewedEligibleForArchive} onClick={() => void archiveViewed()}>{archivingViewed ? "Arquivando…" : jobs?.viewedEligibleForArchive ? `Arquivar ${formatNumber(jobs.viewedEligibleForArchive)} ${jobs.viewedEligibleForArchive === 1 ? "vista" : "vistas"}` : "Nenhuma vaga neste recorte"}</button></section>
      <section className="admin-maintenance-card admin-personal-maintenance"><h4>Arquivar acervo ativo sem apagar</h4><p><strong>Alcance global:</strong> retira vagas antigas da operação, preservando triagem, pipeline, eventos, rascunhos e demais evidências. Não há teto fixo; deixe a quantidade vazia para arquivar todo o recorte.</p><label>Publicadas antes de<input type="date" value={archivedBefore} onChange={event => setArchivedBefore(event.target.value)} required /><small>Usa a publicação na fonte; quando ausente, usa o recebimento pelo Radar. A data escolhida não entra no recorte.</small></label><label>Quantidade a arquivar<input type="number" min="1" max={archiveTotal || undefined} value={archiveQuantity} onChange={event => setArchiveQuantity(event.target.value)} placeholder={archiveTotal ? `Todas as ${formatNumber(archiveTotal)}` : "Todas"} /></label><div className="admin-impact" aria-live="polite"><strong>{jobs ? formatNumber(selectedArchiveTotal) : "…"}</strong><span>{selectedArchiveTotal === 1 ? "vaga ativa será arquivada" : "vagas ativas serão arquivadas"}, começando pelas mais antigas</span></div><button type="button" className="admin-archive-button" disabled={archivingJobs || !archivedBefore || !selectedArchiveTotal} onClick={() => void archiveActiveJobs()}>{archivingJobs ? "Arquivando…" : selectedArchiveTotal ? `Arquivar ${formatNumber(selectedArchiveTotal)} ${selectedArchiveTotal === 1 ? "vaga" : "vagas"}` : "Nenhuma vaga neste recorte"}</button></section>
      <section className="admin-maintenance-card"><h4>Excluir acervo inativo definitivamente</h4><p><strong>Alcance global:</strong> apaga as vagas selecionadas e também triagem, rascunhos registrados, pipeline, eventos e demais dados vinculados. Usuários, preferências, fontes e integrações são preservados. A operação é atômica: se uma etapa falhar, nada é apagado.</p><label>Situação da vaga<select value={purgeScope} onChange={event => setPurgeScope(event.target.value as PurgeScope)}><option value="archived">Arquivadas</option><option value="possibly_closed">Possivelmente encerradas</option><option value="closed">Encerradas</option></select></label><label>Publicadas antes de<input type="date" value={archivedBefore} onChange={event => setArchivedBefore(event.target.value)} required /><small>Usa a data publicada pela fonte; quando ela não existe, usa a data em que o Radar recebeu a vaga. A data escolhida não entra no recorte.</small></label><label>Quantidade a excluir<input type="number" min="1" max={purgeTotal || undefined} value={purgeQuantity} onChange={event => setPurgeQuantity(event.target.value)} placeholder={purgeTotal ? `Todas as ${formatNumber(purgeTotal)}` : "Todas"} /></label><div className="admin-impact" aria-live="polite"><strong>{jobs ? formatNumber(selectedPurgeTotal) : "…"}</strong><span>{selectedPurgeTotal === 1 ? "vaga" : "vagas"} {purgeLabel} {selectedPurgeTotal === 1 ? "será apagada" : "serão apagadas"} globalmente, começando pelas mais antigas</span></div><button type="button" className="admin-danger-button" disabled={purgingArchived || !archivedBefore || !selectedPurgeTotal} onClick={() => void purgeInactive()}>{purgingArchived ? "Excluindo…" : selectedPurgeTotal ? `Excluir ${purgeDescription}` : "Nenhuma vaga neste recorte"}</button></section>
      <section className="admin-maintenance-card admin-full-cleanup"><h4>Apagar todo o banco de vagas</h4><p>Esta opção ignora situação e data. Todas as vagas são apagadas; itens com histórico operacional protegido podem bloquear a limpeza.</p><label>Para confirmar, digite <strong>{CONFIRMATION}</strong><input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={CONFIRMATION} /></label><button type="button" className="admin-danger-button" disabled={cleaning || confirmation !== CONFIRMATION || !jobs?.total} onClick={() => void clearJobs()}>{cleaning ? "Limpando…" : "Limpar base de vagas"}</button></section>
    </section>}
  </section>;
}
