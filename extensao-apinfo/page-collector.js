/**
 * page-collector.js — roda como content script injetado na aba ativa do
 * APinfo. Lê SOMENTE o que já está renderizado na página atual (a pessoa
 * precisa ter navegado até ali manualmente pelos controles do próprio
 * site) e devolve os campos estruturados de cada vaga do resultado.
 *
 * Diferente do LinkedIn, o APinfo já mostra a descrição completa de cada
 * vaga na própria listagem — não é preciso abrir cada card individualmente,
 * então este script não simula cliques nem espera carregamento adicional.
 */
(() => {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();

  const cards = [...document.querySelectorAll("div.box-vagas.linha.pd")];

  const totalMatch = document.body.innerText.match(/Encontradas\s*:\s*([\d.,]+)\s*vagas/i);
  const totalResults = totalMatch ? Number(totalMatch[1].replace(/\D/g, "")) : 0;

  const pageMatch = document.body.innerText.match(/Página\s+(\d+)\s+de\s+(\d+)/i);
  const currentPage = pageMatch ? Number(pageMatch[1]) : 1;
  const totalPages = pageMatch ? Number(pageMatch[2]) : 1;

  const jobs = cards
    .map((card) => {
      const dataLocal = clean(card.querySelector(".info-data")?.textContent);
      const titulo = clean(card.querySelector(".cargo")?.textContent);
      const paragraphs = [...card.querySelectorAll(".texto p")];
      const descricao = clean(paragraphs[0]?.textContent);
      const rodape = clean(paragraphs[1]?.textContent);

      const empresaMatch = rodape.match(/Empresa\s*\.*:\s*([^]*?)\s*Código\s*\.*:/i);
      const codigoMatch = rodape.match(/Código\s*\.*:\s*(\d+)/i);
      const empresa = empresaMatch ? clean(empresaMatch[1]) : "";
      const codigo = codigoMatch ? codigoMatch[1] : "";

      // "Osasco - SP - 10/08/26" -> local = "Osasco - SP", data = "10/08/26"
      const localMatch = dataLocal.match(/^(.*?)\s*-\s*(\d{2}\/\d{2}\/\d{2,4})$/);
      const local = localMatch ? clean(localMatch[1]) : dataLocal;
      const dataPublicacao = localMatch ? localMatch[2] : "";

      const linkCandidatura = card.querySelector('a[href*="enviecv.cfm"]')?.href || "";

      if (!codigo || !titulo || !empresa) return null;

      return {
        codigo_apinfo: codigo,
        titulo,
        empresa,
        local,
        data_publicacao: dataPublicacao,
        descricao,
        // URL sintética e estável (não expira, não depende de token de
        // sessão) — usada como identificador único da vaga no Radar e no
        // dedupe do CSV. O código da vaga é público e reaparece igual em
        // toda parte do site, diferente do link de candidatura, que carrega
        // um token de sessão e muda a cada carregamento da mesma vaga.
        // Esta URL busca pelo código no site (não é garantido abrir a vaga
        // diretamente) — serve como referência estável, não como link de
        // candidatura. Use link_candidatura para se candidatar.
        link: `https://www.apinfo.com/apinfo/inc/list4.cfm?keyw=${codigo}`,
        link_candidatura: linkCandidatura,
        coletado_em: new Date().toISOString(),
        pagina: currentPage,
      };
    })
    .filter(Boolean);

  return { jobs, totalResults, currentPage, totalPages };
})();
