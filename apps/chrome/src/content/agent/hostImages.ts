import { send } from "../../shared/messages";

/** At most three pictures per tool call reach the model; `detachResultImages` applies the same cap. */
const MAX_IMAGES = 3, MAX_DEPTH = 6;

const pending = (value: any) => value?.imageContext?.requested === true &&
  value.imageContext.delivery === "urls_only_until_host_attaches" && Array.isArray(value.imageContext.images);

/**
 * Skills whose image hosts the page cannot read (NGA attachments) return `imageContext` with
 * `delivery: 'urls_only_until_host_attaches'`. The background fetches those URLs and each one becomes an
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
  const fetched = await send("sw:nga_images", {urls})
    .catch(error => urls.map(url => ({url, error: error instanceof Error ? error.message : String(error)})));
  signal?.throwIfAborted();
  const loaded = new Map(fetched.map(item => [item.url, item]));
  const rewrite = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== "object" || depth > MAX_DEPTH) return value;
    if (Array.isArray(value)) return value.map(item => rewrite(item, depth + 1));
    if (!contexts.includes(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item, depth + 1)]));
    const context = (value as any).imageContext;
    const images = context.images.map((image: any) => {
      const item = loaded.get(image?.url);
      if (!item) return {...image, status: "unavailable", error: `Only ${MAX_IMAGES} pictures are attached per call; request the rest separately.`};
      if ("error" in item) return {...image, status: "unavailable", error: item.error};
      return {...image, type: "image", mimeType: item.mimeType, data: item.data, width: item.width, height: item.height};
    });
    return {...value, imageContext: {...context, images, delivery: images.some((image: any) => image.type === "image") ? "image_parts" : "unavailable"}};
  };
  return rewrite(result, 0);
}
