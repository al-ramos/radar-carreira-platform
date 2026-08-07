import type { Provider } from "./connectors";

export type CuratedSource = { id: string; name: string; provider: Provider; externalRef: string };

// Fontes confirmadas pelo processo de descoberta do projeto radar-vagas.
// Cada item abaixo respondeu à API pública do seu ATS antes de entrar no catálogo.
const catalog = `
BCG|greenhouse|bcg
TCS|greenhouse|tcs
Thoughtworks|greenhouse|thoughtworks
Nubank|ashby|nubank
Stone|greenhouse|stone
C6 Bank|greenhouse|c6bank
QuintoAndar|greenhouse|quintoandar
VTEX|greenhouse|vtex
Gympass|greenhouse|gympass
Neon|lever|neon
Ebanx|greenhouse|ebanx
Wildlife Studios|greenhouse|wildlifestudios
Arco Educação|greenhouse|arcoeducacao
Binance|greenhouse|binance
Azul|lever|azul
Elo Group|greenhouse|elo
Cortex Intelligence|greenhouse|cortex
Vitta|greenhouse|vitta
BTG Pactual|greenhouse|btgpactual
XP Inc|greenhouse|xpinc
Inter|greenhouse|inter
Via|greenhouse|via
Braskem|greenhouse|braskem
Minerva Foods|ashby|minerva
Banco Pan|greenhouse|bancopan
Clear Corretora|greenhouse|clear
Warren Investimentos|ashby|warren
Nomad|ashby|nomad
Insider Store|greenhouse|insider
Shein Brasil|greenhouse|shein
New Balance Brasil|greenhouse|new
McAfee|greenhouse|mcafee
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
Pure Storage|greenhouse|purestorage
Extreme Networks|lever|extremenetworks
Appian|greenhouse|appian
Mendix|lever|mendix
UiPath|ashby|uipath
Blue Prism|lever|blue
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
Velocity Partners|ashby|velocity
Gorilla Logic|ashby|gorilla
PSL Corp|greenhouse|psl
Kin + Carta|ashby|kin
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
Bold Commerce|greenhouse|bold
Mollie|ashby|mollie
Adyen|greenhouse|adyen
Stripe|greenhouse|stripe`;

export const CURATED_SOURCES: CuratedSource[] = catalog.trim().split("\n").map(row => {
  const [name, provider, externalRef] = row.split("|");
  return { id: `${provider}-${externalRef}`, name, provider: provider as Provider, externalRef };
});

export const findCuratedSource = (id: string) => CURATED_SOURCES.find(source => source.id === id);
