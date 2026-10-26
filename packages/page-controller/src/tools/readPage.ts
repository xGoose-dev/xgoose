import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "@xgoose/core";

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s : "null";
  } catch {
    return String(value);
  }
}

// Explicit budgets stop at record boundaries and expose the next row offset.
function paginateArray(format:string,items:unknown[],maxBytes:number,offset:number) {
  let bytes=2;
  const out:unknown[]=[];
  for(const item of items.slice(offset)){
    const size=new TextEncoder().encode(safeJson(item)).length+1;
    if(out.length && bytes+size>maxBytes)break;
    out.push(item);bytes+=size;
  }
  const nextOffset=offset+out.length<items.length?offset+out.length:null;
  return {ok:true,format,totalCount:items.length,returnedCount:out.length,offset,nextOffset,
    ...(nextOffset!==null?{truncated:true}:{}),items:out};
}

function paginateText(format:string,value:string,maxBytes:number,offset:number) {
  const remaining=value.slice(offset),bytes=new TextEncoder().encode(remaining);
  // Streaming decoding holds an incomplete UTF-8 character for the next read.
  const text=bytes.length>maxBytes?new TextDecoder().decode(bytes.subarray(0,maxBytes),{stream:true}):remaining;
  const nextOffset=offset+text.length<value.length?offset+text.length:null;
  return {ok:true,format,[format]:text,offset,nextOffset,
    ...(nextOffset!==null?{truncated:true}:{}),sizeBytes:new TextEncoder().encode(value).length};
}

/**
 * Direct-DOM reading without writing JS. Closes the gap where the agent
 * previously had to hand-roll `js_exec` with `document.querySelectorAll(...)`
 * scrapers for every "read the page" operation. Runs in the content script's
 * isolated world (which shares the same live DOM as the page) so no bridge
 * round-trip is needed.
 */
export function createReadPageTool(): XgooseBuiltTool {
  return defineTool({
    name: "read_page",
    description:
      "Read content from the current page without writing JavaScript. Returns the visible text, full HTML, link list, or heading outline of an element (defaults to <body>). Prefer this over `js_exec` for plain reading; reach for `js_exec` only when you need a complex query or to interact with the page.",
    inputSchema: z.object({
      format: z
        .enum(["text", "html", "links", "outline"])
        .describe(
          "text=rendered innerText (best for summarisation); html=outerHTML (for advanced parsing); " +
            "links=array of {href,text,title?,ariaLabel?} for every <a href>; outline=array of " +
            "{level,text,id?} for h1-h6 (best for navigating long pages).",
        ),
      selector: z
        .string()
        .optional()
        .describe(
          'CSS selector to scope the read (defaults to "body"). Pass a tighter selector on large ' +
            'pages — e.g. "#search" on Google, "main" on most articles.',
        ),
      maxBytes: z
        .number()
        .int()
        .min(500)
        .optional()
        .describe("Optional content byte budget; omitted returns all content. Continue with nextOffset as offset."),
      offset:z.number().int().min(0).optional().describe('Character offset for text/HTML, row offset for links/outline. Pass nextOffset to continue.'),
    }),
    isReadOnly: true,
    isConcurrencySafe: () => true,
    label: (i) => {
      const fmt = String(i?.format ?? "text");
      const sel = i?.selector ? ` ${truncate(String(i.selector), 28)}` : "";
      return `Read page ${fmt}${sel}`;
    },
    execute: async ({ format, selector, maxBytes, offset=0 }) => {
      const max = maxBytes ?? Infinity;
      const sel = selector ?? "body";
      let root: Element | null = null;
      try {
        root = document.querySelector(sel);
      } catch (err: any) {
        return {
          ok: false,
          error: `Invalid selector: ${err?.message ?? String(err)}`,
        };
      }
      if (!root) {
        return { ok: false, error: `No element matched selector: ${sel}` };
      }

      if (format === "text") {
        return paginateText(format,(root as HTMLElement).innerText ?? root.textContent ?? "",max,offset);
      }
      if (format === "html") {
        return paginateText(format,root.outerHTML,max,offset);
      }

      if (format === "links") {
        const anchors = root.querySelectorAll("a[href]");
        const links: Array<{
          href: string;
          text: string;
          title?: string;
          ariaLabel?: string;
        }> = [];
        for (const a of Array.from(anchors)) {
          const aEl = a as HTMLAnchorElement;
          const href = aEl.href;
          if (!href) continue;
          const text = (aEl.innerText || aEl.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          const item: {
            href: string;
            text: string;
            title?: string;
            ariaLabel?: string;
          } = {
            href,
            text,
          };
          const title = aEl.getAttribute("title");
          const ariaLabel = aEl.getAttribute("aria-label");
          if (title) item.title = title;
          if (ariaLabel) item.ariaLabel = ariaLabel;
          links.push(item);
        }
        return paginateArray("links", links, max, offset);
      }

      if (format === "outline") {
        const headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
        const outline: Array<{ level: number; text: string; id?: string }> = [];
        for (const h of Array.from(headings)) {
          const hEl = h as HTMLElement;
          const text = (hEl.innerText || hEl.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          if (!text) continue;
          const level = Number(hEl.tagName[1]);
          const item: { level: number; text: string; id?: string } = {
            level,
            text,
          };
          if (hEl.id) item.id = hEl.id;
          outline.push(item);
        }
        return paginateArray("outline", outline, max, offset);
      }

      return { ok: false, error: `Unknown format: ${format}` };
    },
  });
}
