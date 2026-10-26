import { z } from 'zod';
import { defineTool } from './buildTool';
import { DEFAULT_OUTPUT_CHARS, readToolOutputPage } from './outputPages';

export function createReadToolOutputTool() {
  return defineTool({
    name: 'read_tool_output',
    description: 'Read another page of a saved tool result without executing the original operation again. Pass outputId and nextOffset from the previous page. Text is a consecutive fragment of the original serialized output; choose maxChars and which pages to read for your analysis.',
    inputSchema: z.object({
      outputId:z.string().min(1),
      nextOffset:z.number().int().min(0).default(0),
      maxChars:z.number().int().positive().default(DEFAULT_OUTPUT_CHARS),
    }),
    isReadOnly:true,
    isConcurrencySafe:()=>true,
    label:()=> 'Read saved tool output',
    execute:({outputId,nextOffset,maxChars})=>readToolOutputPage(outputId,nextOffset,maxChars),
  });
}
