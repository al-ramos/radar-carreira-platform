import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { jobSources } from "../db/schema";

export const hashCollectorSecret=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,"0")).join("");

export type CollectorIdentity={userId:string|null};

export async function authenticateLinkedInCollectorSecret(provided:string):Promise<CollectorIdentity|null>{
 if(!provided)return null;
 const source=(await getDb().select({externalRef:jobSources.externalRef}).from(jobSources).where(eq(jobSources.id,"linkedin-extension")).limit(1))[0];
 if(source){
  try{const config=JSON.parse(source.externalRef) as {hash?:string;userId?:string};if(config.hash&&await hashCollectorSecret(provided)===config.hash)return {userId:config.userId??null}}catch{}
 }
 const secrets=env as unknown as {LINKEDIN_COLLECTOR_SECRET?:string;COLLECTOR_SECRET?:string};
 const legacy=secrets.LINKEDIN_COLLECTOR_SECRET||secrets.COLLECTOR_SECRET;
 return legacy&&provided===legacy?{userId:null}:null;
}

export async function validLinkedInCollectorSecret(provided:string){return Boolean(await authenticateLinkedInCollectorSecret(provided));}
