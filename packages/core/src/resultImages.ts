import type { XgooseToolContentPart } from './tools/buildTool';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Per tool result; the model context keeps at most eight images overall. */
const MAX_IMAGES = 3, MAX_DATA_CHARS = 600_000, MAX_DEPTH = 6;
const detached = new WeakMap<object, XgooseToolContentPart[]>();

const isImage = (value: any) => value?.type === 'image' && typeof value.data === 'string' && IMAGE_TYPES.has(value.mimeType);

/**
 * Takes skill-returned images (`{type:'image', mimeType, data}`) out of a result, so their bytes reach the model
 * as image parts and never the journal or result text. Each image keeps its other fields plus `attached` (its
 * number among the parts) or `omitted`. Results without images are returned unchanged.
 */
export function detachResultImages(result: unknown): unknown {
  const parts: XgooseToolContentPart[] = [];
  let found = 0;
  const walk = (value: unknown, depth: number): unknown => {
    if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return value;
    if (Array.isArray(value)) return value.map(item => walk(item, depth + 1));
    if (!isImage(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, depth + 1)]));
    found++;
    const {type, data, ...rest} = value as Record<string, any>;
    if (data.length > MAX_DATA_CHARS) return {...rest, omitted: 'image data exceeds the model limit'};
    if (parts.length / 2 >= MAX_IMAGES) return {...rest, omitted: `only ${MAX_IMAGES} images are attached per tool call`};
    const attached = parts.length / 2 + 1;
    parts.push({type: 'text', text: `Image ${attached}${typeof rest.url === 'string' ? ` (${rest.url})` : ''}:`}, {type: 'file-data', data, mediaType: rest.mimeType});
    return {...rest, attached};
  };
  const value = walk(result, 0);
  if (!found) return result;
  detached.set(value as object, parts);
  return value;
}

/** Image parts taken from a result by `detachResultImages`; handed out once. */
export function resultImageParts(result: unknown): XgooseToolContentPart[] {
  if (!result || typeof result !== 'object') return [];
  const parts = detached.get(result) ?? [];
  detached.delete(result);
  return parts;
}
