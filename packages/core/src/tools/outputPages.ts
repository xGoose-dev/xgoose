import type { XgooseToolContentPart } from './buildTool';

export const DEFAULT_OUTPUT_CHARS = 250_000;
const savedOutputs = new Map<string, string>();
let sequence = 0;

function sliceEnd(text: string, offset: number, maxChars: number): number {
  let end = Math.min(text.length, offset + maxChars);
  // Keep a Unicode surrogate pair together while guaranteeing forward progress.
  if (end < text.length && end > offset) {
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end += end === offset + 1 ? 1 : -1;
  }
  return end;
}

export function readToolOutputPage(outputId: string, offset = 0, maxChars = DEFAULT_OUTPUT_CHARS) {
  const text = savedOutputs.get(outputId);
  if (text === undefined) throw new Error('Saved output is no longer available in this page.');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) throw new Error('Invalid output offset.');
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) throw new Error('maxChars must be a positive integer.');
  // Refresh recently read results before evicting an older saved output.
  savedOutputs.delete(outputId); savedOutputs.set(outputId, text);
  const end = sliceEnd(text, offset, maxChars);
  return { outputId, offset, totalChars: text.length,
    nextOffset: end < text.length ? end : null,
    text: text.slice(offset, end) };
}

/** Page the final text representation, preserving the original result and order. */
export function pageToolOutput(parts: XgooseToolContentPart[], maxChars = DEFAULT_OUTPUT_CHARS): XgooseToolContentPart[] {
  const size = parts.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 0), 0);
  if (size <= maxChars) return parts;
  const text = parts.filter((part): part is {type:'text';text:string} => part.type === 'text').map(part => part.text).join('\n');
  const outputId = `output-${Date.now().toString(36)}-${++sequence}`;
  savedOutputs.set(outputId, text);
  while (savedOutputs.size > 32) savedOutputs.delete(savedOutputs.keys().next().value!);
  const first = readToolOutputPage(outputId, 0, maxChars);
  return [{type:'text',text:JSON.stringify({...first,
    continuation:{tool:'read_tool_output',args:{outputId,nextOffset:first.nextOffset}},
  })}, ...parts.filter(part => part.type !== 'text')];
}
