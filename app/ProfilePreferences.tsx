"use client";

import { KeyboardEvent, useState } from "react";
import {
  alexsandroProfilePreset, AREA_OPTIONS, AVOID_TERM_OPTIONS, BLOCKED_WORK_TYPE_OPTIONS, CONTRACT_OPTIONS, DAILY_LANGUAGE_OPTIONS,
  ProfileChoices, REGION_OPTIONS, SENIORITY_OPTIONS, SKILL_GROUPS, SKILL_OPTIONS, WORK_MODE_OPTIONS,
} from "../lib/profile-options";
import AdminSettings from "./AdminSettings";

type Props = {
  value: ProfileChoices;
  onChange: (value: ProfileChoices) => void;
  onSave: () => void;
  onClose: () => void;
  message: string;
  isAdmin: boolean;
  isOwner: boolean;
  aiStatus?: { provider: { configured: boolean; provider: string | null; model: string | null }; usage: { usedTokens: number; limit: number; remainingTokens: number; period: string } } | null;
};

type ChoiceFieldProps = {
  label: string;
  hint: string;
  options: string[];
  groups?: Array<{ label: string; options: string[] }>;
  value: string[];
  onChange: (value: string[]) => void;
  customPlaceholder: string;
  allowCustom?: boolean;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase("pt-BR");

function ChoiceField({ label, hint, options, groups, value, onChange, customPlaceholder, allowCustom = true }: ChoiceFieldProps) {
  const [custom, setCustom] = useState("");
  const selected = new Set(value.map(normalize));
  const customValues = value.filter(item => !options.some(option => normalize(option) === normalize(item)));
  const toggle = (option: string) => onChange(selected.has(normalize(option)) ? value.filter(item => normalize(item) !== normalize(option)) : [...value, option]);
  const allSelected = options.length > 0 && options.every(option => selected.has(normalize(option)));
  const toggleAll = () => onChange(allSelected ? [] : [...value, ...options.filter(option => !selected.has(normalize(option)))]);
  const selectionLabel = value.length === 0 ? "Nenhuma selecionada" : `${value.length} selecionada${value.length === 1 ? "" : "s"}`;
  const addCustom = () => {
    const additions = custom.split(",").map(item => item.trim()).filter(item => item && !selected.has(normalize(item)));
    if (additions.length) onChange([...value, ...additions]);
    setCustom("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); addCustom(); }
  };

  return <details className="profile-choice-field">
    <summary><span className="profile-choice-heading"><strong>{label}</strong><small>{hint}</small></span><span className="profile-choice-status">{selectionLabel}</span></summary>
    <div className="profile-choice-body">
      <div className="profile-choice-actions"><button type="button" aria-label={`${allSelected ? "Limpar" : "Selecionar"} todas as opções de ${label}`} aria-pressed={allSelected} onClick={toggleAll}>{allSelected ? "Limpar seleção" : "Selecionar todas"}</button></div>
      {groups ? <div className="profile-choice-categories">{groups.map(group => {
        const selectedCount = group.options.filter(option => selected.has(normalize(option))).length;
        const groupAllSelected = selectedCount === group.options.length;
        const toggleGroup = () => onChange(groupAllSelected
          ? value.filter(item => !group.options.some(option => normalize(option) === normalize(item)))
          : [...value, ...group.options.filter(option => !selected.has(normalize(option)))]);
        return <details className="profile-choice-category" key={group.label}>
          <summary><span>{group.label}</span><div className="profile-choice-category-actions"><button type="button" aria-label={`${groupAllSelected ? "Limpar" : "Selecionar"} todas as competências de ${group.label}`} aria-pressed={groupAllSelected} onClick={event => { event.preventDefault(); toggleGroup(); }}>{groupAllSelected ? "Limpar" : "Selecionar todas"}</button><small>{selectedCount ? `${selectedCount} selecionada${selectedCount === 1 ? "" : "s"}` : "Expandir"}</small></div></summary>
          <div className="profile-choice-grid">{group.options.map(option => <label key={option} className="profile-choice"><input type="checkbox" checked={selected.has(normalize(option))} onChange={() => toggle(option)} />{option}</label>)}</div>
        </details>;
      })}</div> : <div className="profile-choice-grid">{options.map(option => <label key={option} className="profile-choice"><input type="checkbox" checked={selected.has(normalize(option))} onChange={() => toggle(option)} />{option}</label>)}</div>}
      {allowCustom && <><div className="profile-custom-choice"><input value={custom} onChange={event => setCustom(event.target.value)} onKeyDown={onKeyDown} placeholder={customPlaceholder} /><button type="button" onClick={addCustom}>Adicionar</button></div>{customValues.length > 0 && <div className="profile-custom-tags">{customValues.map(option => <button type="button" key={option} onClick={() => onChange(value.filter(item => normalize(item) !== normalize(option)))}>{option} ×</button>)}</div>}</>}
    </div>
  </details>;
}

export default function ProfilePreferences({ value, onChange, onSave, onClose, message, isAdmin, isOwner, aiStatus }: Props) {
  const [presetLoaded, setPresetLoaded] = useState(false);
  const update = <K extends keyof ProfileChoices>(key: K, next: ProfileChoices[K]) => onChange({ ...value, [key]: next });
  const updateCareerRule = <K extends keyof ProfileChoices["careerRules"]>(key: K, next: ProfileChoices["careerRules"][K]) =>
    update("careerRules", { ...value.careerRules, [key]: next });
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="modal profile-choice-modal" onClick={event => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="Fechar preferências">×</button>
      <p className="eyebrow">MEU PERFIL</p><h2>Preferências do radar</h2>
      <p>Selecione o que procura. Você também pode incluir qualquer opção personalizada.</p>
      <section className="career-profile-section" aria-labelledby="career-positioning-title">
        <div className="career-profile-heading">
          <div><span>PERSONALIZAÇÃO</span><h3 id="career-positioning-title">Como o Radar deve representar você</h3></div>
          <small>Estas informações afetam o veredito e a candidatura de cada vaga.</small>
        </div>
        <div className="career-preset-row">
          <div><strong>Perfil estratégico Alexsandro Ramos</strong><small>Carrega posicionamento, stack, projeto AMR, preferências e bloqueadores do documento.</small></div>
          <button type="button" onClick={() => { onChange(alexsandroProfilePreset()); setPresetLoaded(true); }}>Carregar perfil completo</button>
        </div>
        {presetLoaded && <p className="career-preset-notice" role="status">Perfil carregado para revisão. Clique em “Salvar preferências” para aplicá-lo somente à sua conta.</p>}
        <div className="career-profile-grid">
          <label>Nome profissional<input value={value.careerRules.professionalName} onChange={event => updateCareerRule("professionalName", event.target.value)} placeholder="Ex.: Alexsandro Ramos" /></label>
          <label>Título de apresentação<input value={value.careerRules.professionalTitle} onChange={event => updateCareerRule("professionalTitle", event.target.value)} placeholder="Ex.: Desenvolvedor .NET Pleno" /></label>
          <label>Localização-base<input value={value.careerRules.baseLocation} onChange={event => updateCareerRule("baseLocation", event.target.value)} placeholder="Ex.: Mogi das Cruzes, SP" /></label>
          <label>Dias presenciais por semana<input type="number" min="0" max="7" value={value.careerRules.maxHybridDays} onChange={event => updateCareerRule("maxHybridDays", Math.max(0, Math.min(7, Number(event.target.value) || 0)))} /></label>
          <label>Limite mensal de tokens<input type="number" min="0" max="10000000" step="1000" value={value.careerRules.aiMonthlyTokenLimit} onChange={event => updateCareerRule("aiMonthlyTokenLimit", Math.max(0, Math.min(10000000, Number(event.target.value) || 0)))} /></label>
        </div>
        <label className="career-profile-wide">Resumo profissional<textarea value={value.careerRules.professionalSummary} onChange={event => updateCareerRule("professionalSummary", event.target.value)} placeholder="Experiência, diferenciais e posicionamento que podem ser usados nas análises e candidaturas." /></label>
        <label className="career-profile-wide">Projeto ou experiência-âncora<textarea value={value.careerRules.anchorProject} onChange={event => updateCareerRule("anchorProject", event.target.value)} placeholder="Projeto relevante que comprova suas competências sem exagerar capacidades." /></label>
        <label className="career-disclosure"><input type="checkbox" checked={value.careerRules.discloseGapsInEmail} onChange={event => updateCareerRule("discloseGapsInEmail", event.target.checked)} /><span><strong>Mencionar gaps no e-mail</strong><small>Quando ativado, a candidatura informa honestamente requisitos da vaga que não constam no perfil.</small></span></label>
        <div className="ai-profile-status" role="status">
          <span className={aiStatus?.provider.configured ? "configured" : "pending"} aria-hidden="true" />
          <div><strong>{aiStatus?.provider.configured ? `IA configurada · ${aiStatus.provider.model}` : "IA ainda não configurada"}</strong><small>{aiStatus ? `${aiStatus.usage.usedTokens.toLocaleString("pt-BR")} de ${aiStatus.usage.limit.toLocaleString("pt-BR")} tokens usados em ${aiStatus.usage.period}` : "As regras personalizadas funcionam normalmente sem IA."}</small></div>
        </div>
      </section>
      <div className="profile-score-row"><label>Score mínimo<input type="number" min="0" max="100" value={value.minScore} onChange={event => update("minScore", Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /></label><small>Exiba apenas oportunidades com score a partir deste valor.</small></div>
      <ChoiceField label="Senioridades aceitas" hint="Pode marcar mais de uma." options={SENIORITY_OPTIONS} value={value.seniority} onChange={next => update("seniority", next)} customPlaceholder="Outra senioridade" />
      <ChoiceField label="Formato de trabalho" hint="Escolha remoto, híbrido, presencial ou uma combinação. Sem seleção, todas as vagas continuam visíveis." options={WORK_MODE_OPTIONS} value={value.preferredMode} onChange={next => update("preferredMode", next)} customPlaceholder="" allowCustom={false} />
      <ChoiceField label="Competências dominadas" hint="Elas valem até 60 pontos: o score cresce proporcionalmente ao número de stacks selecionadas que a vaga atende." options={SKILL_OPTIONS} groups={SKILL_GROUPS} value={value.masteredSkills} onChange={next => update("masteredSkills", next)} customPlaceholder="Adicionar tecnologia" />
      <ChoiceField label="Áreas desejadas" hint="Usadas para destacar oportunidades do seu foco." options={AREA_OPTIONS} value={value.desiredAreas} onChange={next => update("desiredAreas", next)} customPlaceholder="Adicionar área" />
      <ChoiceField label="Termos a evitar" hint="Vagas que contêm estes termos ficam com score zero." options={AVOID_TERM_OPTIONS} value={value.avoidTerms} onChange={next => update("avoidTerms", next)} customPlaceholder="Adicionar termo" />
      <ChoiceField label="Regiões aceitas" hint="Usadas para avaliar vagas híbridas ou presenciais." options={REGION_OPTIONS} value={value.careerRules.acceptedRegions} onChange={next => updateCareerRule("acceptedRegions", next)} customPlaceholder="Adicionar cidade ou região" />
      <ChoiceField label="Contratos preferidos" hint="A ordem selecionada não bloqueia automaticamente outros regimes." options={CONTRACT_OPTIONS} value={value.careerRules.preferredContracts} onChange={next => updateCareerRule("preferredContracts", next)} customPlaceholder="" allowCustom={false} />
      <ChoiceField label="Idiomas para comunicação diária" hint="Uma vaga que exigir outro idioma pode ser bloqueada." options={DAILY_LANGUAGE_OPTIONS} value={value.careerRules.dailyCommunicationLanguages} onChange={next => updateCareerRule("dailyCommunicationLanguages", next)} customPlaceholder="Adicionar idioma" />
      <ChoiceField label="Senioridades bloqueadas" hint="Têm poder de veto, diferentemente das senioridades apenas menos desejadas." options={SENIORITY_OPTIONS} value={value.careerRules.blockedSeniorities} onChange={next => updateCareerRule("blockedSeniorities", next)} customPlaceholder="Outra senioridade" />
      <ChoiceField label="Tipos de atuação bloqueados" hint="Use apenas para atividades que você realmente não aceita." options={BLOCKED_WORK_TYPE_OPTIONS} value={value.careerRules.blockedWorkTypes} onChange={next => updateCareerRule("blockedWorkTypes", next)} customPlaceholder="Adicionar tipo de atuação" />
      <ChoiceField label="Exceções de stack" hint="Combinações ou domínios aceitos mesmo fora da stack principal." options={[]} value={value.careerRules.stackExceptions} onChange={next => updateCareerRule("stackExceptions", next)} customPlaceholder="Ex.: VBA + Access + SQL Server, QA .NET" />
      {message && <div className="notice">{message}</div>}<div className="source-actions"><button className="primary" onClick={onSave}>Salvar preferências</button></div>
      {isAdmin && <AdminSettings isOwner={isOwner} />}
    </section>
  </div>;
}
