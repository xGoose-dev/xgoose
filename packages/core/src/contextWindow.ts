import {convertMessages} from '@earendil-works/pi-ai/api/openai-completions';
import {getCurrentTools,normalizeContext,getCurrentSystemMessage} from '@earendil-works/pi-ai/utils/transcript';
import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {Model,Api} from '@earendil-works/pi-ai';

const encoder=new TextEncoder();
export const textBytes=(text:string)=>encoder.encode(text).length;
export function clipBytes(text:string,max:number):string {
  if(textBytes(text)<=max)return text;
  let low=0,high=text.length;
  while(low<high){const mid=Math.ceil((low+high)/2);if(textBytes(text.slice(0,mid))<=max)low=mid;else high=mid-1;}
  if(low>0&&/[\uD800-\uDBFF]/.test(text[low-1]))low--;
  return text.slice(0,low);
}
export function textChunks(text:string,maxBytes:number):string[]{
  const chunks:string[]=[];let offset=0;
  while(offset<text.length){const chunk=clipBytes(text.slice(offset),maxBytes);if(!chunk)break;chunks.push(chunk);offset+=chunk.length;}
  return chunks;
}
export function omitImageBytes(_key:string,value:any):any {
  if(value?.type==='image'||value?.type==='image_url')return {type:'text',text:'[Attached image; bytes omitted from text summary]'};
  return value;
}
export function modelOnlyMessage(message:AgentMessage):AgentMessage {
  if(message.role!=='toolResult')return message;
  const {details,...bounded}=message;return bounded;
}
/** Count the wire messages, schemas, system prompt, JSON escaping and UTF-8. */
export function requestTextBytes(messages:AgentMessage[],model:Model<Api>):number {
  const normalized=normalizeContext({messages:messages.map(modelOnlyMessage) as any});
  const wireMessages=model.api==='openai-completions'
    ?convertMessages(model as any,normalized,{...model.compat,supportsDeveloperRole:false,supportsMidConvoSystemMessages:false} as any)
    :normalized.messages;
  const tools=getCurrentTools(normalized.messages).map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.parameters,strict:false}}));
  // Margin includes transport options and Hosted normalization metadata.
  return textBytes(JSON.stringify({model:model.id,messages:wireMessages,tools},omitImageBytes))+4096;
}
export function collapsedSystem(messages:AgentMessage[]):AgentMessage[] {
  const system=getCurrentSystemMessage(messages);
  return system?[system]:[];
}
/** Explicit excerpts only when summarization fails; never present them as full evidence. */
export function excerptSummary(messages:AgentMessage[],max=18000):string {
  const rows=messages.filter(m=>m.role!=='system').map(message=>{
    const json=JSON.stringify(modelOnlyMessage(message),omitImageBytes);
    const links=[...new Set(json.match(/https?:\/\/[^\s"<>\\]+/g)??[])].slice(0,12).join('\n');
    return clipBytes(json,700)+(textBytes(json)>1100?'\n[Middle omitted]\n'+clipBytes(json.slice(-700),1000):'')+(links?'\nSources: '+links:'');
  });
  const text='Automatic summary was unavailable. These are incomplete history excerpts, not complete evidence. Previously performed actions must not be replayed. Omitted details remain unverified.\n'+rows.join('\n\n');
  return clipBytes(text,max);
}
