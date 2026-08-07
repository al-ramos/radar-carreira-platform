import type { Provider } from "./connectors";

export type CuratedSource = { id: string; name: string; provider: Provider; externalRef: string };

// Fontes confirmadas pelo processo de descoberta do projeto radar-vagas.
// Cada item abaixo respondeu à API pública do seu ATS com vagas da empresa
// correta na auditoria de 06/08/2026. Fontes que falharam nessa checagem
// (0 vagas, ou vagas de uma empresa diferente por colisão de slug) foram
// movidas para QUARANTINED_SOURCES, ao final deste arquivo.
const catalog = `
Thoughtworks|greenhouse|thoughtworks
Nubank|ashby|nubank
C6 Bank|greenhouse|c6bank
QuintoAndar|greenhouse|quintoandar
VTEX|greenhouse|vtex
Gympass|greenhouse|gympass
Neon|lever|neon
Ebanx|greenhouse|ebanx
Wildlife Studios|greenhouse|wildlifestudios
Arco Educação|greenhouse|arcoeducacao
Azul|lever|azul
Elo Group|greenhouse|elo
Cortex Intelligence|greenhouse|cortex
Vitta|greenhouse|vitta
BTG Pactual|greenhouse|btgpactual
XP Inc|greenhouse|xpinc
Inter|greenhouse|inter
Braskem|greenhouse|braskem
Banco Pan|greenhouse|bancopan
Shein Brasil|greenhouse|shein
Okta|greenhouse|okta
Datadog|greenhouse|datadog
New Relic|greenhouse|newrelic
SolarWinds|greenhouse|solarwinds
GitLab|greenhouse|gitlab
Docker|ashby|docker
Canonical|greenhouse|canonical
Veeam Software|greenhouse|veeamsoftware
Commvault|greenhouse|commvault
Rubrik|greenhouse|rubrik
Extreme Networks|lever|extremenetworks
Appian|greenhouse|appian
Mendix|lever|mendix
UiPath|ashby|uipath
Snowflake|ashby|snowflake
Databricks|greenhouse|databricks
Matillion|lever|matillion
Fivetran|greenhouse|fivetran
Confluent|ashby|confluent
MongoDB|greenhouse|mongodb
Redis|ashby|redis
Elastic|greenhouse|elastic
Neo4j|greenhouse|neo4j
Percona|ashby|percona
Capco|greenhouse|capco
Valtech|greenhouse|valtech
AKQA|greenhouse|akqa
R/GA|greenhouse|rga
Wunderman Thompson|greenhouse|wundermanthompson
Getnet|greenhouse|getnet
Twilio|greenhouse|twilio
RD Station|greenhouse|rdstation
ActiveCampaign|lever|activecampaign
FullStory|ashby|fullstory
Mixpanel|greenhouse|mixpanel
Amplitude|greenhouse|amplitude
Simon Data|ashby|simondata
Listrak|greenhouse|listrak
Klaviyo|greenhouse|klaviyo
Omnisend|lever|omnisend
Yotpo|greenhouse|yotpo
Gorgias|ashby|gorgias
Recharge|ashby|recharge
Mollie|ashby|mollie
Adyen|greenhouse|adyen
Stripe|greenhouse|stripe`;

export const CURATED_SOURCES: CuratedSource[] = catalog.trim().split("\n").map(row => {
  const [name, provider, externalRef] = row.split("|");
  return { id: `${provider}-${externalRef}`, name, provider: provider as Provider, externalRef };
});

export const findCuratedSource = (id: string) => CURATED_SOURCES.find(source => source.id === id);

// Fontes retiradas do catálogo ativo na auditoria de 06/08/2026.
// Motivo "sem vagas": o endpoint responde, mas o board está vazio há tempo
// suficiente para não valer a pena manter ativo por padrão.
// Motivo "empresa incorreta": o slug colidiu com outra empresa na mesma
// plataforma — a API devolve vagas reais, mas de um board que não é o
// pretendido. Mantidos aqui como registro; não usar em novas ativações
// sem antes localizar o board correto (frequentemente em outra plataforma,
// como Gupy) ou remover em definitivo.
export const QUARANTINED_SOURCES: (CuratedSource & { reason: string; ambiguousSlug?: true })[] = [
  { id: "greenhouse-bcg", name: "BCG", provider: "greenhouse", externalRef: "bcg", reason: "sem vagas: endpoint responde com jobs: []" },
  { id: "greenhouse-stone", name: "Stone", provider: "greenhouse", externalRef: "stone", reason: "sem vagas: endpoint responde com jobs: []" },
  { id: "greenhouse-binance", name: "Binance", provider: "greenhouse", externalRef: "binance", reason: "sem vagas: endpoint responde com jobs: []" },
  { id: "greenhouse-tcs", name: "TCS", provider: "greenhouse", externalRef: "tcs", reason: "empresa incorreta: retorna vagas da Thornbury Community Services (saúde, Reino Unido)", ambiguousSlug: true },
  { id: "greenhouse-clear", name: "Clear Corretora", provider: "greenhouse", externalRef: "clear", reason: "empresa incorreta: retorna vagas da CLEAR (identificação em aeroportos, EUA)" },
  { id: "ashby-warren", name: "Warren Investimentos", provider: "ashby", externalRef: "warren", reason: "empresa incorreta: retorna vagas de fintech de pensão em Ghent, Bélgica" },
  { id: "ashby-nomad", name: "Nomad", provider: "ashby", externalRef: "nomad", reason: "empresa incorreta: retorna vagas da Nomad Labs, gestão de aluguel em Denver (EUA)" },
  { id: "greenhouse-insider", name: "Insider Store", provider: "greenhouse", externalRef: "insider", reason: "empresa incorreta: retorna vagas da Business Insider (veículo de mídia)" },
  { id: "greenhouse-new", name: "New Balance Brasil", provider: "greenhouse", externalRef: "new", reason: "empresa incorreta: retorna 1 vaga de 2021 de \"Sonja Inc.\"", ambiguousSlug: true },
  { id: "greenhouse-mcafee", name: "McAfee", provider: "greenhouse", externalRef: "mcafee", reason: "empresa incorreta: retorna vagas da McAfee Heating and Air Conditioning (Ohio, EUA)" },
  { id: "greenhouse-purestorage", name: "Pure Storage", provider: "greenhouse", externalRef: "purestorage", reason: "empresa incorreta: retorna vagas da Everpure (filtros de água)" },
  { id: "lever-blue", name: "Blue Prism", provider: "lever", externalRef: "blue", reason: "empresa incorreta: retorna vagas da BlueCloud (consultoria Snowflake)", ambiguousSlug: true },
  { id: "ashby-velocity", name: "Velocity Partners", provider: "ashby", externalRef: "velocity", reason: "empresa incorreta: retorna vagas da Velocity, fintech de stablecoin" },
  { id: "ashby-gorilla", name: "Gorilla Logic", provider: "ashby", externalRef: "gorilla", reason: "empresa incorreta: retorna vagas da Gorilla, SaaS de energia" },
  { id: "greenhouse-psl", name: "PSL Corp", provider: "greenhouse", externalRef: "psl", reason: "empresa incorreta: retorna vagas de \"Pearson Spectre Litt\"", ambiguousSlug: true },
  { id: "ashby-kin", name: "Kin + Carta", provider: "ashby", externalRef: "kin", reason: "empresa incorreta: retorna vagas da Kin Insurance (seguros residenciais, EUA)", ambiguousSlug: true },
  { id: "greenhouse-via", name: "Via", provider: "greenhouse", externalRef: "via", reason: "empresa incorreta: retorna vagas da Via Transportation (mobilidade urbana, EUA)", ambiguousSlug: true },
  { id: "ashby-minerva", name: "Minerva Foods", provider: "ashby", externalRef: "minerva", reason: "empresa incorreta: retorna vagas de startup de Nova York sem relação com o frigorífico" },
  { id: "greenhouse-bold", name: "Bold Commerce", provider: "greenhouse", externalRef: "bold", reason: "estagnada: apenas 1 vaga registrada, sem publicação desde 2024", ambiguousSlug: true },
];
