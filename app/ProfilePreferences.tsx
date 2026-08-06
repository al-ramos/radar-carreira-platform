"use client";

import { KeyboardEvent, useState } from "react";
import {
  AREA_OPTIONS, AVOID_TERM_OPTIONS, CITY_OPTIONS, ProfileChoices, SENIORITY_OPTIONS, SKILL_GROUPS, SKILL_OPTIONS, WORK_MODE_OPTIONS,
} from "../lib/profile-options";
import AdminSettings from "./AdminSettings";

type Props = {
  value: ProfileChoices;
  onChange: (value: ProfileChoices) => void;
  onSave: () => void;
  onClose: () => void;
  message: string;
  isAdmin: boolean;
};

type ChoiceFieldProps = {
  label: string;
  hint: string;
  options: string[];
  groups?: Array<{ label: string; options: string[] }>;
  value: string[];
  onChange: (value: string[]) => void;
  customPlaceholder: string;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase("pt-BR");

function ChoiceField({ label, hint, options, groups, value, onChange, customPlaceholder }: ChoiceFieldProps) {
  const [custom, setCustom] = useState("");
  const selected = new Set(value.map(normalize));
  const customValues = value.filter(item => !options.some(option => normalize(option) === normalize(item)));
  const toggle = (option: string) => onChange(selected.has(normalize(option)) ? value.filter(item => normalize(item) !== normalize(option)) : [...value, option]);
  const addCustom = () => {
    const additions = custom.split(",").map(item => item.trim()).filter(item => item && !selected.has(normalize(item)));
    if (additions.length) onChange([...value, ...additions]);
    setCustom("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); addCustom(); }
  };

  return <fieldset className="profile-choice-field">
    <legend>{label}</legend><p>{hint}</p>
    {groups ? <div className="profile-choice-categories">{groups.map(group => <section key={group.label}><h3>{group.label}</h3><div className="profile-choice-grid">{group.options.map(option => <label key={option} className="profile-choice"><input type="checkbox" checked={selected.has(normalize(option))} onChange={() => toggle(option)} />{option}</label>)}</div></section>)}</div> : <div className="profile-choice-grid">{options.map(option => <label key={option} className="profile-choice"><input type="checkbox" checked={selected.has(normalize(option))} onChange={() => toggle(option)} />{option}</label>)}</div>}
    <div className="profile-custom-choice"><input value={custom} onChange={event => setCustom(event.target.value)} onKeyDown={onKeyDown} placeholder={customPlaceholder} /><button type="button" onClick={addCustom}>Adicionar</button></div>
    {customValues.length > 0 && <div className="profile-custom-tags">{customValues.map(option => <button type="button" key={option} onClick={() => onChange(value.filter(item => normalize(item) !== normalize(option)))}>{option} ×</button>)}</div>}
  </fieldset>;
}

export default function ProfilePreferences({ value, onChange, onSave, onClose, message, isAdmin }: Props) {
  const update = <K extends keyof ProfileChoices>(key: K, next: ProfileChoices[K]) => onChange({ ...value, [key]: next });
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="modal profile-choice-modal" onClick={event => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="Fechar preferências">×</button>
      <p className="eyebrow">MEU PERFIL</p><h2>Preferências do radar</h2>
      <p>Selecione o que procura. Você também pode incluir qualquer opção personalizada.</p>
      <div className="profile-score-row"><label>Score mínimo<input type="number" min="0" max="100" value={value.minScore} onChange={event => update("minScore", Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /></label><small>O Radar mostra e ordena as oportunidades de acordo com estas preferências.</small></div>
      <ChoiceField label="Senioridades aceitas" hint="Pode marcar mais de uma." options={SENIORITY_OPTIONS} value={value.seniority} onChange={next => update("seniority", next)} customPlaceholder="Outra senioridade" />
      <ChoiceField label="Modalidades aceitas" hint="Sem seleção, todas as modalidades continuam visíveis." options={WORK_MODE_OPTIONS} value={value.preferredMode} onChange={next => update("preferredMode", next)} customPlaceholder="Outra modalidade" />
      <ChoiceField label="Cidades e regiões" hint="Marque locais ou inclua cidades adicionais." options={CITY_OPTIONS} value={value.cities} onChange={next => update("cities", next)} customPlaceholder="Adicionar cidade ou região" />
      <ChoiceField label="Competências dominadas" hint="Catálogo amplo do mercado de TI, organizado por área. Usadas para calcular a aderência das vagas." options={SKILL_OPTIONS} groups={SKILL_GROUPS} value={value.masteredSkills} onChange={next => update("masteredSkills", next)} customPlaceholder="Adicionar tecnologia" />
      <ChoiceField label="Áreas desejadas" hint="Usadas para destacar oportunidades do seu foco." options={AREA_OPTIONS} value={value.desiredAreas} onChange={next => update("desiredAreas", next)} customPlaceholder="Adicionar área" />
      <ChoiceField label="Termos a evitar" hint="Vagas que contêm estes termos ficam com score zero." options={AVOID_TERM_OPTIONS} value={value.avoidTerms} onChange={next => update("avoidTerms", next)} customPlaceholder="Adicionar termo" />
      {message && <div className="notice">{message}</div>}<div className="source-actions"><button className="primary" onClick={onSave}>Salvar preferências</button></div>
      {isAdmin && <AdminSettings />}
    </section>
  </div>;
}
