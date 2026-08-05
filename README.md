# Radar Carreira Platform

Portal multiusuário para reunir vagas, calcular a aderência ao perfil profissional e acompanhar candidaturas em um único lugar.

**Produção:** [radar-carreira-almir-v2.prof-andreiamr.chatgpt.site](https://radar-carreira-almir-v2.prof-andreiamr.chatgpt.site)

> A hospedagem atual usa Sign in with ChatGPT. O portal está público, mas o visitante precisa entrar com uma conta ChatGPT para acessar as áreas identificadas.

## O que o portal faz

- reúne vagas recebidas por Gmail, importação JSON/CSV e páginas públicas de carreiras;
- evita duplicações por `fingerprint` e identificador externo;
- exibe vagas das últimas 24 horas, 3 dias, 7 dias ou de todo o histórico;
- calcula um score explicável considerando competências, áreas, senioridade, modalidade, localização, atualidade e termos a evitar;
- mostra a descrição dentro do próprio Radar e mantém um botão separado para o LinkedIn;
- permite copiar a descrição para uso em outras ferramentas;
- mantém um pipeline individual de vagas salvas, candidaturas, entrevistas, ofertas e encerramentos;
- envia um resumo diário por Gmail quando existem oportunidades acima do score mínimo;
- registra importações, eventos, qualidade dos dados e ciclo de vida das vagas.

## Recursos disponíveis

### Para usuários

- Radar com busca, filtros de período e score mínimo;
- perfil profissional e preferências de aderência;
- detalhe da vaga no portal;
- acesso ao anúncio original;
- pipeline Kanban com notas;
- alertas e resumo diário;
- métricas pessoais.

### Para administradores

- importação manual em JSON ou CSV;
- modelo CSV para download;
- cadastro e ativação de fontes Greenhouse, Lever e Ashby;
- coleta manual e agendada;
- integração Gmail `RadarVagas`;
- configurações e parâmetros operacionais;
- monitoramento de coletas;
- auditoria e qualidade dos dados;
- gestão de usuários e funções;
- backup administrativo;
- relatório compatível com Excel.

## Fluxo dos dados

```text
Gmail/RadarVagas ─┐
JSON ou CSV ──────┼─> normalização e deduplicação ─> Cloudflare D1 ─> Radar e pipeline
ATS públicos ─────┘                                  │
                                                     └─> score, alertas e resumo diário
```

As senhas do Gmail não são armazenadas. O conector do Google Apps Script envia apenas mensagens recentes da etiqueta `RadarVagas`, usando uma chave exclusiva cujo hash fica registrado no banco.

## Stack

- Next.js 16 e React 19;
- TypeScript;
- vinext, Vite e Cloudflare Workers;
- Drizzle ORM e Cloudflare D1;
- Tailwind CSS e identidade visual em Geist;
- OpenAI Sites para hospedagem e Sign in with ChatGPT;
- GitHub Actions e Google Apps Script para automações.

## Executar localmente

Pré-requisitos:

- Node.js 22.13 ou superior;
- npm.

```bash
npm install
npm run dev
```

Use a URL exibida pelo servidor. Sem um binding D1 local, a interface pode usar dados demonstrativos para a visualização inicial.

Comandos úteis:

```bash
npm run build
npm test
npm run lint
npm run db:generate
```

## Banco de dados

O projeto usa Cloudflare D1. O schema principal está em `db/schema.ts` e as migrações estão em `drizzle/`.

Principais tabelas:

- `profiles`: perfil, preferências e função do usuário;
- `job_sources`: fontes e configuração protegida do Gmail;
- `jobs`: vagas, descrições, status e deduplicação;
- `user_job_status`: pipeline individual e notas;
- `job_events`: histórico de eventos;
- `import_runs`: execução e resultado das importações;
- `platform_settings`: parâmetros administrativos;
- `alert_preferences`: preferências de alertas;
- `alert_reads`: alertas visualizados;
- `alert_deliveries`: controle de resumos enviados, evitando duplicação.

Cada projeto publicado no Sites possui seu próprio banco D1. Publicar o mesmo código em um novo endereço não transfere automaticamente vagas, perfis, fontes ou configurações do banco anterior.

## Integração Gmail RadarVagas

### 1. Preparar o Gmail

Crie ou mantenha uma etiqueta chamada exatamente `RadarVagas` e direcione para ela os alertas de vagas e candidaturas.

### 2. Registrar a chave no portal

Entre como administrador, abra **Gmail RadarVagas**, crie uma chave com pelo menos 24 caracteres e clique em **Salvar**.

### 3. Configurar o Apps Script

Baixe `public/gmail-radarvagas.gs`, cole o conteúdo em um projeto do Google Apps Script e adicione estas propriedades em **Configurações do projeto → Propriedades do script**:

| Propriedade | Valor |
|---|---|
| `RADAR_URL` | `https://radar-carreira-almir-v2.prof-andreiamr.chatgpt.site` |
| `RADAR_SECRET` | A mesma chave salva no painel Gmail RadarVagas |

Não coloque a chave diretamente no arquivo `.gs`.

Execute `importarRadarVagas` manualmente para testar. Na primeira execução, autorize o acesso ao Gmail e às conexões externas. Se ainda não existir um acionador, execute `instalarColetaDiaria` uma vez.

Mantenha somente o acionador `importarRadarVagas`; acionadores antigos chamados `coletar` devem ser removidos.

O conector atual:

- lê mensagens das últimas 48 horas;
- consulta até 100 tópicos recentes da etiqueta;
- importa alertas compatíveis;
- atualiza candidaturas reconhecidas no pipeline;
- tenta enriquecer vagas do LinkedIn;
- prepara e envia o resumo diário quando houver correspondências suficientes.

## Coleta de fontes públicas

O painel aceita os identificadores públicos de páginas hospedadas em:

- Greenhouse;
- Lever;
- Ashby.

O GitHub Actions executa, em dias úteis:

1. coleta das fontes ativas;
2. enriquecimento das vagas;
3. verificação de vagas possivelmente encerradas.

Configuração do repositório:

| Tipo | Nome | Uso |
|---|---|---|
| Variable | `RADAR_BASE_URL` | URL publicada do portal |
| Secret | `COLLECTOR_SECRET` | Chave compartilhada com o ambiente do Sites |

Uma execução HTTP bem-sucedida pode retornar `sources: 0` quando nenhuma fonte foi cadastrada. O resultado real deve ser conferido pelos campos `sources`, `received`, `inserted`, `updated` e `errors`.

## Integração com a extensão LinkedIn Job Collector

A extensão `al-ramos/linkedin-job-collector` pode enviar diretamente ao Radar as vagas filtradas por stack.

Endpoint:

```text
POST /api/collector/import
Authorization: Bearer <LINKEDIN_COLLECTOR_SECRET>
Content-Type: application/json
```

Exemplo de payload:

```json
{
  "source": "linkedin-extension",
  "stacks": ["java", "aws"],
  "jobs": [
    {
      "empresa": "Empresa Exemplo",
      "titulo": "Engenheiro de Software Java",
      "local": "Brasil · Remoto",
      "descricao": "Java, Spring Boot e AWS",
      "stack": ["Java", "Spring", "AWS"],
      "link": "https://www.linkedin.com/jobs/view/1234567890/",
      "coletado_em": "2026-08-05T18:00:00.000Z"
    }
  ]
}
```

Configure no ambiente publicado uma chave exclusiva chamada `LINKEDIN_COLLECTOR_SECRET`. Enquanto ela não existir, o endpoint aceita `COLLECTOR_SECRET` como compatibilidade. A chave deve ter pelo menos 24 caracteres, permanecer somente no ambiente do portal e no armazenamento local da extensão e nunca ser versionada.

O endpoint:

- aceita até 2 MB e 2.000 vagas por requisição;
- normaliza os campos em português ou inglês;
- grava na tabela `jobs` do Cloudflare D1;
- preserva stacks identificadas pela extensão;
- deduplica pelo `fingerprint` existente;
- registra a execução em `import_runs`;
- permite CORS sem cookies porque a autenticação ocorre pelo token Bearer.

## Autenticação e autorização

- o Sites fornece a identidade autenticada por cabeçalhos protegidos;
- o servidor cria ou atualiza o perfil no primeiro acesso;
- usuários comuns veem Radar, pipeline, alertas, métricas e preferências;
- recursos administrativos são verificados novamente no servidor;
- administradores principais são protegidos contra rebaixamento acidental.

## Situação atual

Já implantado:

- portal público e banco D1;
- perfis e autorização administrativa;
- vagas persistentes e deduplicação;
- importação JSON/CSV;
- integração Gmail RadarVagas validada;
- conectores Greenhouse, Lever e Ashby;
- pipeline, alertas, métricas, monitoramento, auditoria e qualidade;
- backup, relatório e gestão de usuários;
- coleta agendada, enriquecimento e ciclo de vida;
- testes de build, recursos e acesso administrativo.

Pendências conhecidas:

1. melhorar a interpretação de alguns assuntos de e-mail, evitando título e empresa invertidos;
2. melhorar descrição, stack, modalidade e localização das vagas do LinkedIn;
3. recalcular scores após o enriquecimento dos dados;
4. criar uma importação paginada para o histórico completo da etiqueta `RadarVagas`;
5. importar a planilha ou backup anterior, caso o arquivo seja recuperado;
6. cadastrar fontes ATS reais no banco de produção;
7. validar o próximo ciclo diário automático e o primeiro resumo com vagas acima do score mínimo;
8. avaliar hospedagem externa caso seja necessário acesso sem conta ChatGPT.

## Desenvolvimento

Antes de enviar uma alteração:

```bash
npm test
```

O projeto reaproveita conceitos do `al-ramos/radar-vagas`, reestruturados para uma aplicação web multiusuário com persistência, automação e administração centralizada.
