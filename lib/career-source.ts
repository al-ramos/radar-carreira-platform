import { isPullProvider, type Provider } from "./connectors";

export type CareerSource={provider:Provider;externalRef:string;suggestedName:string};
const title=(slug:string)=>slug.split(/[-_]+/).filter(Boolean).map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(" ");

export function parseCareerSource(value:string, expected?:string):CareerSource{
 const url=new URL(value.trim());
 if(!/^https?:$/.test(url.protocol))throw new Error("Use o link público completo da página de carreiras.");
 const host=url.hostname.toLowerCase(),slug=url.pathname.split("/").filter(Boolean)[0];
 const provider=host.endsWith("boards.greenhouse.io")?"greenhouse":host.endsWith("jobs.lever.co")?"lever":host.endsWith("jobs.ashbyhq.com")?"ashby":null;
 if(!provider||!slug||!isPullProvider(provider))throw new Error("Use uma URL Greenhouse, Lever ou Ashby compatível.");
 if(expected&&provider!==expected)throw new Error(`Este link é da plataforma ${provider}. Selecione a plataforma correspondente.`);
 if(!/^[a-zA-Z0-9_-]+$/.test(slug))throw new Error("Não foi possível identificar a empresa no link informado.");
 return{provider,externalRef:slug,suggestedName:title(slug)};
}
