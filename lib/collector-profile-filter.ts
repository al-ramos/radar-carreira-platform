import type { ImportedJob } from "./jobs";
import { inferTechnologyStack } from "./technology-stack";

export type StackMatchMode="all"|"any";
export type CollectorProfile={requiredStacks:string[];stackMatchMode:StackMatchMode};

const clean=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR").trim();

export function filterImportedJobsByProfile(items:ImportedJob[],profile:CollectorProfile){
 const required=profile.requiredStacks.map(clean).filter(Boolean);
 if(!required.length)return {accepted:items,rejected:0,requiredStacks:[],stackMatchMode:profile.stackMatchMode};
 const accepted=items.filter(item=>{
  const detected=inferTechnologyStack(`${item.title} ${item.description??""}`,item.stack??[]).map(clean);
  return profile.stackMatchMode==="any"?required.some(stack=>detected.includes(stack)):required.every(stack=>detected.includes(stack));
 });
 return {accepted,rejected:items.length-accepted.length,requiredStacks:profile.requiredStacks,stackMatchMode:profile.stackMatchMode};
}
