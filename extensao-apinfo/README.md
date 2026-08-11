# Coletor de Vagas do APinfo

Extensão para Google Chrome com painel próprio que coleta vagas visíveis nas páginas de resultados do APinfo, uma página por vez, remove duplicidades e exporta os resultados consolidados em CSV e JSON — ou envia direto ao Radar de Carreira.

Versão atual da extensão: **1.3.0**.
> Este é um projeto independente. Não é afiliado, patrocinado nem mantido pela APinfo.

## Dois modos de coleta

[#dois-modos-de-coleta](#dois-modos-de-coleta)

### Manual, página por página (com filtro)

Você navega normalmente pelo APinfo — com os filtros de estado, cidade e cargo que quiser — e a cada página clica em **Coletar esta página** na extensão. Funciona com qualquer combinação de filtro, porque quem está navegando é você mesmo, pelos controles nativos da página.

### Automática, todas as páginas (sem filtro)

A extensão avança sozinha por todas as páginas do resultado, usando o mesmo mini-formulário nativo "Pular para a página" que o próprio APinfo expõe — o `background.js` só altera o número da página e submete esse formulário, sem reconstruir a busca do zero. Esse mini-formulário já vem preenchido pelo servidor com os tokens corretos da busca atual (`pkey` e `tcv`), então preserva o resultado.

**Só funciona sem nenhum filtro marcado.** Isso porque a busca de vagas do APinfo é um formulário `POST` com filtros de estado, cidade e cargo, e reenviar esse formulário principal com a página alterada à mão quebra o resultado (testado: a busca "zera" para 1 vaga). O mini-formulário de paginação contorna isso, mas ele não carrega os filtros — só o total de resultados da busca atual, que no modo sem filtro é o total geral de vagas do site.

Para não esbarrar no limite de consultas do APinfo, a coleta automática:

- espera um intervalo configurável entre páginas (padrão 4 segundos);
- para automaticamente depois de um número máximo de páginas por execução (padrão 200);
- interrompe assim que detecta qualquer mensagem do próprio APinfo sinalizando limite de consultas atingido.

O filtro por stack continua disponível — é aplicado na exportação, então mesmo coletando tudo sem filtro, você decide depois quais vagas exportar.

## O que o projeto faz

[#o-que-o-projeto-faz](#o-que-o-projeto-faz)

- Lê as vagas já renderizadas na página atual do APinfo — título, empresa, local, data, código da vaga e descrição completa, tudo já vem na própria listagem.
- Acumula vagas coletadas entre páginas, deduplicadas pelo código da vaga.
- Filtra vagas por stacks selecionadas e termos personalizados.
- Gera um único arquivo CSV e um único arquivo JSON por exportação.
- Não solicita nem armazena login do APinfo — o site não exige login para ver vagas.
- Salva CSV e JSON em uma subpasta configurável de Downloads.
- Pode enviar as vagas compatíveis diretamente ao Radar de Carreira.

## Início rápido

[#início-rápido](#início-rápido)

### Requisitos

[#requisitos](#requisitos)

- Google Chrome ou navegador compatível com extensões Manifest V3.
- Windows, macOS ou Linux.

### 1. Baixar o projeto

[#1-baixar-o-projeto](#1-baixar-o-projeto)

Com Git:

```
git clone https://github.com/al-ramos/apinfo-job-collector.git
cd apinfo-job-collector
```

Também é possível usar **Code → Download ZIP** no GitHub e extrair o arquivo.

### 2. Instalar a extensão no Chrome

[#2-instalar-a-extensão-no-chrome](#2-instalar-a-extensão-no-chrome)

1. Abra `chrome://extensions`.
2. Ative **Modo do desenvolvedor**, no canto superior direito.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `extensao-apinfo` (ou a raiz deste projeto, se você não separou em subpasta).
5. Confirme que aparece **Coletor de Vagas do APinfo 1.3.0**.
6. Opcionalmente, fixe a extensão no menu de extensões do Chrome.

### 3. Abrir o painel

[#3-abrir-o-painel](#3-abrir-o-painel)

1. Clique no ícone da extensão.
2. Clique em **Abrir painel completo**.

## Uso recomendado: painel da extensão

[#uso-recomendado-painel-da-extensão](#uso-recomendado-painel-da-extensão)

### Coletar

[#coletar](#coletar)

1. Clique em **Abrir busca de vagas do APinfo** (ou navegue até `apinfo.com` manualmente).
2. Configure os filtros desejados na página do APinfo: estado, cidade, cargo, palavras-chave.
3. Clique no ícone da extensão e em **Abrir painel completo**.
4. Clique em **Coletar esta página**. As vagas visíveis entram no acumulado.
5. Na página do APinfo, use a paginação nativa do site ("Pular para a página") para ir à próxima página.
6. Volte ao painel e clique em **Coletar esta página** de novo. Repita para quantas páginas quiser.

O contador no topo do painel mostra quantas vagas já estão acumuladas, a página atual e o total de resultados no APinfo.

### Coletar tudo automaticamente (sem filtro)

[#coletar-tudo-automaticamente-sem-filtro](#coletar-tudo-automaticamente-sem-filtro)

1. Abra a busca de vagas do APinfo **sem marcar nenhum filtro** de estado, cidade ou cargo.
2. No painel, ajuste se quiser o intervalo entre páginas e o limite de páginas da execução, na seção **Coleta automática**.
3. Clique em **Coletar todas as páginas**.
4. Acompanhe o progresso na barra ("Página N de M — X vagas coletadas"). É possível clicar em **Cancelar** a qualquer momento — o que já foi coletado permanece acumulado.
5. Ao final (ou se o APinfo sinalizar limite de consultas), a extensão para sozinha e mostra um resumo.

O filtro por stack, nesse modo, é aplicado depois — na exportação, como de costume.

### Filtrar por stacks

[#filtrar-por-stacks](#filtrar-por-stacks)

1. Marque uma ou mais tecnologias em **Stacks aceitas**.
2. Adicione termos específicos separados por vírgula quando necessário.
3. O filtro é aplicado no momento da exportação, não da coleta — você pode mudar os filtros e reexportar sem coletar de novo.

A correspondência usa o título e a descrição da vaga. Uma vaga é mantida quando corresponde a pelo menos uma stack marcada ou termo adicional. Se nenhuma opção for marcada e nenhum termo for informado, todas as vagas acumuladas são exportadas.

### Configurar os destinos

[#configurar-os-destinos](#configurar-os-destinos)

- **Baixar CSV e JSON** grava os arquivos na subpasta indicada dentro da pasta Downloads do Chrome.
- **Enviar ao Radar de Carreira** envia somente as vagas compatíveis ao endpoint configurado.
- É possível ativar os dois destinos ao mesmo tempo.

Para integrar ao portal, use o endpoint:

```
https://radar-carreira-platform.al-ramos.workers.dev/api/collector/import/apinfo-extension
```

Entre como administrador no Radar, abra **Extensão APinfo**, clique em **Gerar chave**, depois em **Salvar** e **Copiar**. Cole essa chave no painel da extensão e clique em **Testar conexão**.

## Sobre o link de cada vaga

[#sobre-o-link-de-cada-vaga](#sobre-o-link-de-cada-vaga)

O APinfo não expõe uma URL pública e estável por vaga — o único link em cada card é o de **Envie seu currículo**, que carrega um token de sessão e muda a cada carregamento da mesma vaga. Usar esse link como identificador quebraria a deduplicação (a mesma vaga pareceria nova a cada coleta).

Por isso, cada vaga é identificada pelo **código** que o próprio APinfo exibe (ex: `85870`) — esse número é público, estável e reaparece igual em toda parte do site. O CSV e o JSON trazem dois campos de link separados:

| Campo             | O que é                                                              |
| ------------------ | --------------------------------------------------------------------- |
| `link`              | URL sintética de referência, construída a partir do código da vaga. Estável, mas não é garantido que abra a vaga diretamente. |
| `link_candidatura` | O link real de "Envie seu currículo" capturado no momento da coleta. Pode expirar — use logo se for se candidatar por ali. |

Desde a versão **1.2.0**, ao enviar ao Radar (**Enviar ao Radar** ativado), `link_candidatura` é enviado também como `applyUrl` — um campo separado que não participa da deduplicação. O painel do Radar usa `applyUrl` (quando presente) como destino do botão **Candidatar**, então o clique abre a vaga de verdade em vez da busca por código. `link` continua sendo o identificador estável usado para não duplicar a vaga entre coletas.

## Captura manual de contato da vaga

[#captura-manual-de-contato-da-vaga](#captura-manual-de-contato-da-vaga)

Algumas vagas do APinfo mostram, depois de um login (CPF e senha, feito por você diretamente na tela do site), uma página com o e-mail da empresa e o assunto sugerido para contato. **A extensão nunca vê, pede nem preenche essa senha** — ela só lê o texto já renderizado na página, e só quando você decide clicar no botão de captura.

Como usar:

1. No card da vaga, clique no link de referência (ou em **Candidatar**) para abrir a página da vaga no APinfo.
2. Faça login normalmente na própria tela do APinfo, se solicitado.
3. Quando a página mostrar **Empresa**, **Email** e **Assunto a ser colocado no email**, volte ao painel da extensão.
4. Clique em **Capturar contato desta vaga**, na seção **Contato da vaga (manual)**.
5. A extensão lê `Empresa`, `Email` e `Assunto` já visíveis na página e guarda esse contato associado ao código da vaga (extraído do próprio assunto sugerido, ex: `apinfo - 85887 - ...`).

O contato capturado fica em `chrome.storage.session` (mesmo armazenamento do acumulado de vagas) até você exportar ou clicar em **Limpar contatos**. Na exportação, cada vaga que tiver um contato capturado ganha os campos `email_contato` e `assunto_email` no CSV/JSON, e — se **Enviar ao Radar** estiver ativado — esses mesmos dados vão como `contactEmail`/`contactSubject`, exibidos no painel do Radar como um link `mailto:` pronto (que só abre seu cliente de e-mail; nada é enviado automaticamente).

Esse fluxo é deliberadamente manual, vaga por vaga: não existe coleta automática de contatos, porque a página de contato fica atrás de login e de um limite de consultas do próprio APinfo — automatizar esse passo específico esbarraria nos dois.

## Arquivos exportados

[#arquivos-exportados](#arquivos-exportados)

Os arquivos são salvos na subpasta configurada dentro de Downloads:

```
RadarCarreira/vagas-apinfo-AAAA-MM-DD.csv
RadarCarreira/vagas-apinfo-AAAA-MM-DD.json
```

### Colunas e propriedades

[#colunas-e-propriedades](#colunas-e-propriedades)

| Campo             | Descrição                                                     |
| ------------------ | ---------------------------------------------------------------- |
| `codigo_apinfo`    | Código da vaga no APinfo — identificador estável                 |
| `titulo`            | Título da vaga                                                    |
| `empresa`           | Nome da empresa                                                   |
| `local`             | Cidade/UF ou "Home Office"                                        |
| `data_publicacao`  | Data exibida pelo APinfo (formato do site, dd/mm/aa)              |
| `descricao`         | Texto completo da descrição, já disponível na listagem            |
| `stack`             | Stacks detectadas no título e na descrição                       |
| `link`              | URL de referência estável (ver seção acima)                      |
| `link_candidatura` | Link de candidatura com token de sessão (ver seção acima)         |
| `email_contato`    | E-mail da empresa, quando capturado manualmente (ver seção acima) |
| `assunto_email`    | Assunto sugerido para o e-mail, quando capturado manualmente      |
| `coletado_em`       | Data e hora da coleta em formato ISO 8601                        |
| `pagina`            | Página da pesquisa em que a vaga foi encontrada                  |

O CSV usa ponto e vírgula como separador, inclui BOM UTF-8 e foi preparado para abertura no Excel em português. O JSON mantém a mesma informação em uma lista de objetos.

## Permissões da extensão

[#permissões-da-extensão](#permissões-da-extensão)

O arquivo `manifest.json` declara:

| Permissão                                                       | Finalidade                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `activeTab`                                                        | Trabalhar na aba ativa no momento em que você clica em coletar                |
| `scripting`                                                        | Executar o coletor na página autorizada                                       |
| `storage`                                                          | Salvar stacks, destinos, pasta, endpoint, chave e o acumulado da sessão       |
| `downloads`                                                        | Gravar CSV e JSON na subpasta configurada sem perguntar a cada execução       |
| `https://www.apinfo.com/*`                                        | Ler somente páginas do APinfo necessárias à coleta                            |
| `https://radar-carreira-platform.al-ramos.workers.dev/*`         | Enviar vagas ao portal somente quando essa opção estiver ativada              |

Note que esta extensão **não pede a permissão `tabs`** (que permitiria listar e trocar entre todas as suas abas abertas) — ela só age na aba que está ativa no momento em que você clica em coletar.

## Privacidade e segurança

[#privacidade-e-segurança](#privacidade-e-segurança)

- O processamento acontece localmente no navegador.
- Por padrão, os dados permanecem locais. Quando **Enviar ao Radar** estiver ativado, somente as vagas filtradas são enviadas ao endpoint indicado.
- Não há backend, banco de dados, telemetria ou analytics.
- A extensão não lê nem armazena login do APinfo — o site não exige login para pesquisar vagas. A página de contato de algumas vagas exige login (CPF e senha, feito por você diretamente na tela do APinfo) — a extensão nunca vê, pede nem preenche essa senha, e só lê o texto (empresa/e-mail/assunto) já renderizado na página quando você clica em **Capturar contato desta vaga**.
- A extensão usa somente o conteúdo já visível na página no momento da coleta.
- O botão "Enviar seu currículo" do APinfo, quando presente, apenas revela um link `mailto:` para o seu cliente de e-mail padrão — a extensão não envia nada em nome de ninguém, nem automatiza esse clique.
- Os arquivos são gerados no próprio navegador e enviados diretamente para a subpasta de Downloads.
- O projeto não tenta contornar CAPTCHA, autenticação, limite de consultas ou controles de acesso — a coleta é deliberadamente manual e no ritmo da sua navegação normal, sem clicar em nada por conta própria na página do APinfo.

Revise o código antes de instalar extensões locais. O projeto é público justamente para permitir auditoria.

## Arquitetura

[#arquitetura](#arquitetura)

```
flowchart LR
    A["Painel — dashboard.html"] -->|mensagens da extensão| C["background.js"]
    C -->|injeta na aba ativa| E["page-collector.js"]
    E -->|vagas da página atual| C
    A -->|Capturar contato desta vaga| C
    C -->|injeta na aba ativa, após login manual| I["contact-collector.js"]
    I -->|empresa/e-mail/assunto| C
    C -->|acumula vagas e contatos em chrome.storage.session| C
    C -->|mescla contato por código, filtra por stacks na exportação| G["Vagas compatíveis"]
    G -->|CSV e JSON| F["Downloads"]
    G -->|Bearer token| H["Radar de Carreira / Cloudflare D1"]
```

    Loading

### Responsabilidade dos arquivos

[#responsabilidade-dos-arquivos](#responsabilidade-dos-arquivos)

| Arquivo             | Responsabilidade                                                        |
| ---------------------- | ---------------------------------------------------------------------------- |
| `manifest.json`        | Manifesto, permissões e versão da extensão                                 |
| `dashboard.html`       | Interface principal: progresso, coleta, filtros e exportação               |
| `dashboard.js`         | Comunicação do painel com o service worker                                 |
| `dashboard.css`        | Estilos do painel completo                                                 |
| `stacks.js`            | Catálogo de stacks e termos reconhecidos                                    |
| `background.js`        | Orquestra coleta manual e automática, avanço de página, acumulação, deduplicação, contatos e exportação |
| `page-collector.js`    | Lê os cartões de vaga da página atual do APinfo                             |
| `contact-collector.js` | Lê empresa/e-mail/assunto já renderizados na página de contato de uma vaga, após login manual |
| `popup.html`           | Interface do popup da extensão                                              |
| `popup.js`             | Ações rápidas do popup (coletar a página atual sem abrir o painel)          |
| `popup.css`            | Estilos do popup                                                             |

## Fluxo interno da coleta

[#fluxo-interno-da-coleta](#fluxo-interno-da-coleta)

### Modo manual

1. Você navega manualmente até uma página de resultados do APinfo.
2. Clica em **Coletar esta página** no painel ou no popup.
3. `background.js` injeta `page-collector.js` na aba ativa.
4. `page-collector.js` lê todos os cartões de vaga (`div.box-vagas.linha.pd`) e devolve os dados estruturados, junto com a página atual e o total de resultados.
5. `background.js` funde o resultado com o acumulado anterior, deduplicado por `codigo_apinfo`.
6. Você repete os passos 1–5 para quantas páginas quiser.

### Modo automático

1. Você abre a busca do APinfo sem filtro e clica em **Coletar todas as páginas**.
2. `dashboard.js` abre uma porta (`chrome.runtime.connect`) com `background.js` e envia `{ type: 'START', tabId, delayMs, maxPages }`.
3. `background.js` coleta a página atual, depois entra num loop: espera `delayMs`, injeta a função `submitPagingForm` (via `func`/`args`, não `files`) para preencher e submeter o mini-formulário nativo "Pular para a página" com o próximo número, aguarda a aba recarregar (`chrome.tabs.onUpdated`), coleta a nova página e verifica se o texto da página bate com algum padrão de limite de consultas.
4. A cada página, `background.js` envia `{ type: 'PROGRESS', ... }` pela porta; `dashboard.js` atualiza a barra e o contador em tempo real.
5. O loop para ao atingir a última página, o limite `maxPages`, detectar limite de consultas, ou receber `{ type: 'CANCEL' }` do painel.
6. Ao final, `background.js` funde tudo com o acumulado anterior (deduplicado por `codigo_apinfo`) e envia `{ type: 'DONE', ... }` com o resumo.

### Exportação (comum aos dois modos)

Ao exportar, `background.js` aplica os filtros de stack salvos e grava CSV/JSON e/ou envia ao Radar.

## Desenvolvimento

[#desenvolvimento](#desenvolvimento)

O projeto usa JavaScript, HTML e CSS puros, sem processo de build e sem dependências npm.

Validações rápidas:

```
node --check background.js
node --check page-collector.js
node --check contact-collector.js
node --check dashboard.js
node --check popup.js
node --check stacks.js
```

Após modificar arquivos da extensão, aumente a versão em `manifest.json`, recarregue a extensão em `chrome://extensions` e repita um teste coletando ao menos duas páginas diferentes.

## Limitações conhecidas

[#limitações-conhecidas](#limitações-conhecidas)

- O APinfo pode alterar classes, estrutura e comportamento da página sem aviso — inclusive o mini-formulário "Pular para a página" usado pela coleta automática.
- Não há link estável por vaga — veja a seção "Sobre o link de cada vaga".
- A coleta automática só funciona sem filtro nenhum marcado; com filtro, use a coleta manual página por página.
- A coleta automática depende da aba do APinfo permanecer aberta e navegável durante toda a execução; fechar ou navegar para outro site nela interrompe a coleta.
- O acumulado fica em `chrome.storage.session` — fechar o Chrome por completo limpa o acumulado não exportado.
- O APinfo aplica limite de consultas em pouco tempo; a coleta automática tenta detectar e parar diante desse limite, mas o site pode mudar a mensagem exibida sem aviso, tornando essa detecção obsoleta.

## Uso responsável

[#uso-responsável](#uso-responsável)

Use a ferramenta somente em conteúdo público. Respeite os termos aplicáveis, a privacidade de terceiros, os limites do site e a legislação da sua jurisdição. A coleta automática existe para trazer o total de vagas de uma vez, mas foi desenhada com intervalo entre páginas e parada automática ao detectar limite de consultas — evite reduzir o intervalo padrão ou rodar execuções em sequência sem pausa entre elas.

## Contribuição

[#contribuição](#contribuição)

1. Crie um fork do repositório.
2. Abra uma branch para a mudança.
3. Atualize a documentação e a versão do manifesto quando necessário.
4. Execute as validações de sintaxe.
5. Teste o fluxo completo: coleta de múltiplas páginas, filtro por stack, exportação CSV/JSON e envio ao Radar.
6. Abra um pull request descrevendo o cenário testado e o resultado.

Ao reportar um problema, inclua a versão da extensão, o navegador, o sistema operacional e a etapa em que a execução parou. Não publique cookies, credenciais ou informações pessoais.
