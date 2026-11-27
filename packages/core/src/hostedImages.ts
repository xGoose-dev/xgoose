import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { HostFetcher } from "./ports";

const MAX_IMAGE_URL_CHARS = 320_050;
const MAX_CACHED_IMAGES = 8;

export type CompressHostedImage = (url: string, maxChars: number) => Promise<string | undefined>;
type ToolContent = Extract<AgentMessage, { role: "toolResult" }>["content"];
type ImagePart = { type: "image_url"; image_url: { url: string } };
type TextPart = { type: "text"; text: string };
type ImagePosition = { message_index: number; content_index: number };
type HostedRequest = { messages: { content?: string | (ImagePart | TextPart)[] | null }[] };

/** Recover source links from the attachment numbers recorded in tool results, including saved chats. */
export function withResultImageSources(attachments: ToolContent, result: unknown): ToolContent {
  const count = attachments.filter(part => part.type === "image").length;
  if (!count) return attachments;
  const sources = new Map<number, string | undefined>();
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== "object" || depth > 6) return;
    const { attached, url } = value as { attached?: number; url?: string };
    if (typeof attached === "number" && Number.isInteger(attached) && attached > 0 && attached <= 3) {
      sources.set(attached, typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined);
      return;
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  visit(result, 0);
  if (sources.size !== count) return attachments;
  let index = 0;
  return attachments.map(part => {
    if (part.type !== "image") return part;
    const sourceUrl = sources.get(++index);
    return sourceUrl ? { ...part, sourceUrl } : part;
  });
}

function imageSources(messages: AgentMessage[]): Map<string, string> {
  const sources = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "toolResult") continue;
    for (const part of message.content) {
      if (part.type === "image" && "sourceUrl" in part && typeof part.sourceUrl === "string") {
        sources.set(`data:${part.mimeType};base64,${part.data}`, part.sourceUrl);
      }
    }
  }
  return sources;
}

function omittedImage(source?: string): TextPart {
  return { type: "text", text: `[Image omitted because it exceeds the Hosted size limit.${source ? ` Source: ${source}` : ""}]` };
}

export function createHostedImageFetch(fetch: HostFetcher, compress?: CompressHostedImage) {
  const cache = new Map<string, string | undefined>();
  return async (input: RequestInfo | URL, init: RequestInit | undefined, messages: AgentMessage[]) => {
    if (typeof init?.body !== "string" || !init.body.includes('"image_url"')) return fetch(input, init);
    const request: HostedRequest = JSON.parse(init.body);
    const sources = imageSources(messages);
    const imageLinks = new Map<ImagePart, string>();
    const signal = init.signal;
    let changed = false;
    let hasImages = false;
    for (const message of request.messages) {
      if (!Array.isArray(message.content)) continue;
      for (const [index, part] of message.content.entries()) {
        if (part.type !== "image_url") continue;
        const { url } = part.image_url;
        const source = sources.get(url);
        if (source) imageLinks.set(part, source);
        if (url.length <= MAX_IMAGE_URL_CHARS) {
          hasImages = true;
          continue;
        }
        signal?.throwIfAborted();
        if (!cache.has(url)) {
          const compressed = await compress?.(url, MAX_IMAGE_URL_CHARS);
          if (cache.size >= MAX_CACHED_IMAGES) cache.delete(cache.keys().next().value!);
          cache.set(url, compressed);
        }
        const compressed = cache.get(url);
        if (compressed && compressed.length <= MAX_IMAGE_URL_CHARS) {
          part.image_url.url = compressed;
          hasImages = true;
        } else {
          message.content[index] = omittedImage(source);
        }
        changed = true;
      }
    }

    const send = () => {
      signal?.throwIfAborted();
      if (!changed) return fetch(input, init);
      const headers = new Headers(init.headers);
      headers.delete("content-length");
      return fetch(input, { ...init, headers, body: JSON.stringify(request) });
    };

    const response = await send();
    if (response.status !== 400 || !hasImages) return response;
    const error = await response.clone().json().catch(() => null);
    // The host wraps gateway errors in the OpenAI SDK's error shape.
    const code = error?.error?.code ?? error?.error;
    const positions: ImagePosition[] | undefined = (error?.error?.detail ?? error?.detail)?.images;
    if (code !== "image_too_large" || !Array.isArray(positions)) return response;

    let removed = false;
    for (const position of positions) {
      if (!Number.isInteger(position?.message_index) || !Number.isInteger(position?.content_index)) continue;
      const content = request.messages[position.message_index]?.content;
      const index = position.content_index;
      if (!Array.isArray(content)) continue;
      const part = content[index];
      if (part?.type !== "image_url") continue;
      content[index] = omittedImage(imageLinks.get(part));
      removed = true;
    }
    if (!removed) return response;
    await response.body?.cancel();
    changed = true;
    return send();
  };
}
