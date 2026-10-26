/** Model windows, not a shared 128K cap. Last checked against vendor docs 2026-10-26. */
export function modelContextWindow(model:string):number {
  const id=model.toLowerCase().replace(/^models\//,'');
  if(id==='luna'||/^gpt-6(?:\.\d+)?-(?:luna|sol)(?:-|$)/.test(id))return 1_050_000;
  if(/^claude-(?:haiku|sonnet|opus)-5-5(?:-|$)/.test(id))return 1_000_000;
  if(/^gemini-(?:2\.[05]|3\.)/.test(id))return 1_048_576;
  if(/^gpt-4\.1(?:-|$)/.test(id))return 1_047_576;
  if(/^(?:o[134](?:-|$))/.test(id))return 200_000;
  if(id==='gpt-4'||/^gpt-4-0[36]/.test(id))return 8_192;
  return 128_000;
}
export const OUTPUT_RESERVE_TOKENS=4096;
export const inputTokenBudget=(window:number)=>Math.max(1024,Math.floor((window-OUTPUT_RESERVE_TOKENS)*.95));
/** Coarse transport guard only; token occupancy decides normal compaction. */
export const requestByteBudget=(window:number)=>Math.min(8_400_000,window*8);
