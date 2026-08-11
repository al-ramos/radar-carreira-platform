/**
 * contact-collector.js — injetado sob demanda quando a pessoa clica em
 * "Capturar contato desta vaga" no painel, estando na tela que o APinfo
 * mostra DEPOIS de logar manualmente com CPF e senha (essa extensão nunca
 * vê nem toca nessas credenciais — só lê o que já está renderizado na tela
 * no momento em que a pessoa decide capturar).
 *
 * A tela típica, depois do login, mostra:
 *   Empresa : <nome>
 *   Email : <endereço>
 *   Assunto a ser colocado no email : apinfo - <código> - <cargo>
 *
 * O código da vaga normalmente vem embutido no próprio assunto sugerido
 * ("apinfo - 85887 - ..."), que é a forma mais confiável de correlacionar
 * esse contato com a vaga já coletada na listagem pública.
 */
(() => {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const bodyText = document.body.innerText || "";

  const emailMatch = bodyText.match(/Email\s*:\s*([^\s]+@[^\s.,;()]+\.[^\s.,;()]+)/i);
  const empresaMatch = bodyText.match(/Empresa\s*:\s*(.+)/i);
  const assuntoMatch = bodyText.match(/Assunto a ser colocado no email\s*:\s*(.+)/i);
  const assunto = assuntoMatch ? clean(assuntoMatch[1]) : "";

  const codigoMatch = assunto.match(/apinfo\s*-\s*(\d+)/i) || bodyText.match(/vaga\s*:\s*(\d+)/i);

  if (!emailMatch || !codigoMatch) {
    return {
      ok: false,
      error:
        'Nenhum contato encontrado nesta página. Faça login no APinfo (CPF e senha, na própria tela do site) e abra a página que mostra "Empresa" e "Email" antes de clicar aqui.',
    };
  }

  return {
    ok: true,
    codigo: codigoMatch[1],
    empresa: empresaMatch ? clean(empresaMatch[1].split(/\n/)[0]) : "",
    email: emailMatch[1],
    assunto,
    capturado_em: new Date().toISOString(),
  };
})();
