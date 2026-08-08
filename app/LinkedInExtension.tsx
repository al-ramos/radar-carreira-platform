"use client";

import { useEffect, useState } from "react";

type LinkedInExtensionProps = { close: () => void; openImport: () => void };

export default function LinkedInExtension({ close, openImport }: LinkedInExtensionProps) {
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState("Carregando integração…");

  useEffect(() => {
    fetch("/api/admin/collector-key")
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setConfigured(Boolean(data.configured));
        setStatus("");
      })
      .catch(() => setStatus("Não foi possível consultar a integração."));
  }, []);

  async function generateKey() {
    setKey(`radar_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`);
    setStatus("Chave gerada. Salve e copie-a agora para a extensão.");
  }

  async function saveKey() {
    if (!key) { setStatus("Gere uma chave antes de salvá-la."); return; }
    setStatus("Salvando chave…");
    try {
      const response = await fetch("/api/admin/collector-key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar a chave.");
      setConfigured(true);
      setStatus("Chave salva. Copie-a para a extensão.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível salvar a chave.");
    }
  }

  async function copyKey() {
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setStatus("Chave copiada. Cole-a no campo “Chave exclusiva do coletor” da extensão.");
  }

  return <div className="modal-backdrop" onClick={close}>
    <section className="modal linkedin-extension-modal" onClick={event => event.stopPropagation()}>
      <button className="modal-close" onClick={close} aria-label="Fechar extensão LinkedIn">×</button>
      <p className="eyebrow">INTEGRAÇÃO ADMINISTRATIVA</p>
      <h2>Extensão LinkedIn</h2>
      <p>Crie uma chave exclusiva para autorizar o envio automático de vagas ao banco do Radar.</p>
      {configured && <div className="linkedin-connected">● <strong>Conexão já configurada</strong></div>}
      <div className="linkedin-key-step">
        <span>1</span><div><b>Gere uma chave segura</b><small>A chave aparece apenas agora. Ela não é sua senha do LinkedIn.</small><input value={key} readOnly placeholder="Clique em Gerar chave" aria-label="Chave exclusiva do coletor" /></div>
        <button className="primary" onClick={generateKey}>Gerar chave</button>
      </div>
      <div className="linkedin-key-step">
        <span>2</span><div><b>Salve e copie a chave</b><small>O Radar guarda somente uma impressão protegida, não o texto da chave.</small></div>
        <button onClick={saveKey} disabled={!key}>Salvar</button><button onClick={copyKey} disabled={!key}>Copiar</button>
      </div>
      <div className="linkedin-key-step linkedin-key-instructions"><span>3</span><div><b>Cole na extensão</b><small>Abra a extensão, ative <strong>Enviar ao Radar</strong>, cole em <strong>Chave exclusiva do coletor</strong> e clique em <strong>Testar conexão</strong>.</small></div></div>
      {status && <div className="notice">{status}</div>}
      <div className="linkedin-extension-fallback"><button onClick={openImport}>Importar arquivo do LinkedIn (JSON ou CSV)</button></div>
    </section>
  </div>;
}
