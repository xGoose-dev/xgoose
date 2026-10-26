import {countTokens,setMergeCacheSize} from 'gpt-tokenizer/encoding/o200k_base';
import {getCurrentTools,normalizeContext} from '@earendil-works/pi-ai/utils/transcript';
import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {Model,Api} from '@earendil-works/pi-ai';
import {modelOnlyMessage} from './contextWindow';
setMergeCacheSize(1000);
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
