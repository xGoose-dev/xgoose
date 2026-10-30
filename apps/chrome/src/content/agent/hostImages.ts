import {readPageImage} from "./pageImages";
import { send } from "../../shared/messages";

/** At most three pictures per tool call reach the model; `detachResultImages` applies the same cap. */
const MAX_IMAGES = 3, MAX_DEPTH = 6;

const pending = (value: any) => value?.imageContext?.requested === true &&
  value.imageContext.delivery === "urls_only_until_host_attaches" && Array.isArray(value.imageContext.images);

/**
 * Skills that return image URLs return `imageContext` with
 * `delivery: 'urls_only_until_host_attaches'`. The shared background reader fetches those URLs and each segment becomes an
 * image value (`{type:'image', mimeType, data}`) that `detachResultImages` hands to the model.
 * Works for skill_call results and for skill results returned from js_exec code.
 */
export async function attachHostImages(result: unknown, signal?: AbortSignal): Promise<unknown> {
  const contexts: any[] = [];
  const collect = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > MAX_DEPTH) return;
    if (pending(value)) contexts.push(value);
    else for (const item of Array.isArray(value) ? value : Object.values(value)) collect(item, depth + 1);
  };
  collect(result, 0);
  const urls = [...new Set(contexts.flatMap(value => value.imageContext.images.map((image: any) => image?.url))
    .filter((url): url is string => typeof url === "string"))].slice(0, MAX_IMAGES);
  if (!urls.length) return result;
  const budget = Math.max(1, Math.floor(MAX_IMAGES / urls.length));
  const pageImages = await Promise.all(urls.map(url => readPageImage(url, budget)));
  const missing = urls.filter((_, index) => !pageImages[index]);
  const downloaded = missing.length ? await send("sw:read_images", {urls: missing, maxParts: budget * missing.length})
    .catch(error => missing.map(url => ({url, error: error instanceof Error ? error.message : String(error)}))) : [];
  const fetched = pageImages.filter(item => item !== null).concat(downloaded as any);
  signal?.throwIfAborted();
  const loaded = new Map(fetched.map(item => [item.url, item]));
  const rewrite = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== "object" || depth > MAX_DEPTH) return value;
    if (Array.isArray(value)) return value.map(item => rewrite(item, depth + 1));
    if (!contexts.includes(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, depth + 1)]));
    const context = (value as any).imageContext;
    const images = context.images.flatMap((image: any) => {
      const item = loaded.get(image?.url);
      if (!item) return {...image, status: "unavailable", error: `Only ${MAX_IMAGES} pictures are attached per call; request the rest separately.`};
      if ("error" in item) return {...image, status: "unavailable", error: item.error};
      return item.images.map((part,index)=>({...image,...part,segment:index+1,segments:item.images.length}));
    });
    return {...value, imageContext: {...context, images, delivery: images.some((image: any) => image.type === "image") ? "image_parts" : "unavailable"}};
  };
  return rewrite(result, 0);
}
