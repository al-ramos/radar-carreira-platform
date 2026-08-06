"use client";

type LinkedInExtensionProps = {
  close: () => void;
  openImport: () => void;
};

export default function LinkedInExtension({ close, openImport }: LinkedInExtensionProps) {
  function importJobs() {
    close();
    openImport();
  }

  return <div className="modal-backdrop" onClick={close}>
    <section className="modal linkedin-extension-modal" onClick={event => event.stopPropagation()}>
      <button className="modal-close" onClick={close} aria-label="Fechar extensão LinkedIn">×</button>
      <p className="eyebrow">INTEGRAÇÃO DE COLETA</p>
      <h2>Extensão LinkedIn</h2>
      <p>Importe no Radar o arquivo JSON ou CSV exportado pelo seu coletor de vagas do LinkedIn.</p>
      <ol className="linkedin-extension-steps">
        <li><b>Colete vagas no LinkedIn</b><span>Use o coletor que preferir e exporte os resultados em JSON ou CSV.</span></li>
        <li><b>Envie o arquivo ao Radar</b><span>O Radar reconhece automaticamente cargo, empresa, localização, modalidade, data e link da vaga.</span></li>
        <li><b>Revise no Radar</b><span>As vagas novas entram como ativas e as repetidas são atualizadas sem criar duplicidade.</span></li>
      </ol>
      <div className="linkedin-extension-format"><strong>Formatos aceitos</strong><span>JSON ou CSV · até 2 MB · até 2.000 vagas por importação</span></div>
      <div className="source-actions"><a className="csv-template" href="/modelo-importacao.csv" download>Baixar modelo CSV</a><button className="primary" onClick={importJobs}>Importar arquivo do LinkedIn</button></div>
    </section>
  </div>;
}
