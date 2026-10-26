import {convertMessages} from '@earendil-works/pi-ai/api/openai-completions';
import {getCurrentTools,normalizeContext,getCurrentSystemMessage} from '@earendil-works/pi-ai/utils/transcript';
import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {Model,Api} from '@earendil-works/pi-ai';
import {countTokens,setMergeCacheSize} from 'gpt-tokenizer/encoding/o200k_base';
setMergeCacheSize(1000);

const encoder=new TextEncoder();
export const textBytes=(text:string)=>encoder.encode(text).length;
/** Bounded BPE chunks avoid pathological giant-word work. Counts are estimates:
 * provider tokenizers and image accounting can differ; upstream rejection wins. */
export function estimateTextTokens(text:string):number {
  let tokens=0;
  for(let offset=0;offset<text.length;){
    let end=Math.min(text.length,offset+8192);
    if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
    tokens+=countTokens(text.slice(offset,end),{disallowedSpecial:new Set()});offset=end;
  }
  return tokens;
}
export function requestContextTokens(messages:AgentMessage[],model:Model<Api>):number {
  const normalized=normalizeContext({messages:messages.map(modelOnlyMessage) as any});
  let images=0;
  const json=JSON.stringify({messages:normalized.messages,tools:getCurrentTools(normalized.messages)},(key,value)=>{
    if(value?.type==='image'){images++;return {type:'text',text:'[attached image]'};}
    if(['usage','timestamp','api','provider','model'].includes(key))return undefined;
    return value;
  });
  // o200k BPE is a local estimate for non-OpenAI tokenizers too. Keep a modest
  // allowance for their framing differences, in addition to the input reserve.
  return Math.ceil(estimateTextTokens(json)*(/claude|gemini/.test(model.id)?1.1:1))+1024+images*8192;
}
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
