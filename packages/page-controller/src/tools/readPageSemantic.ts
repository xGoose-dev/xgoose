import { z } from "zod";
import { defineTool, type XgooseBuiltTool } from "@xgoose/core";
import {
  awaitDomQuiet,
  buildDomSnapshot,
  renderText,
  type DomSnapshot,
} from "@xgoose/dom-snapshot";

const DEFAULT_MAX_BYTES = 30_000;
const MAX_MAX_BYTES = 100_000;
const MAX_WAIT_FOR_STABLE_MS = 1500;

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

/**
 * Dehydrated semantic snapshot of the live DOM. Companion to `read_page`:
 * `read_page` returns raw text/HTML/link lists, while this tool returns the
 * accessibility-tree-style structure with stable element IDs the agent can
 * later target with action tools (TBD).
 *
 * Built on `@xgoose/dom-snapshot` — see that package for the dehydration
 * algorithm (modal scoping, three-tier element filtering, AccName 1.2
 * subset, etc).
 */
export function createReadPageSemanticTool(): XgooseBuiltTool {
  return defineTool({
    name: "read_page_semantic",
    description:
      "Return a compact accessibility-tree snapshot of the current page: roles, accessible names, ARIA states, and stable [id=N] markers on every interactive element. Prefer this over `read_page` when you need to understand the *shape* of the page (forms, navigation, lists) rather than just its prose, or when you plan to act on a specific control. The IDs are valid only until the next call.",
    inputSchema: z.object({
      format: z
        .enum(["text", "json"])
        .optional()
        .describe(
          "text=indented YAML-ish accessibility snapshot (token-efficient, best default); json=structured {rootIds,nodes} map (use when you need to programmatically pick a child).",
        ),
      selector: z
        .string()
        .optional()
        .describe(
          'CSS selector for the subtree to dehydrate. Defaults to "body". Pass tighter selectors ("#search", "main") on large pages.',
        ),
      includeHidden: z
        .boolean()
        .optional()
        .describe(
          "Include display:none / aria-hidden / off-screen elements. Default false. Turn on only when you suspect the agent needs to discover hidden state.",
        ),
      scopeToModal: z
        .boolean()
        .optional()
        .describe(
          "When exactly one visible <dialog> or [role=dialog][aria-modal=true] is open, scope the walk to it. Default true.",
        ),
      waitForStableMs: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_FOR_STABLE_MS)
        .optional()
        .describe(
          "Wait up to this many ms for the DOM to stop mutating before snapshotting. Useful on SPAs that render skeletons first. Default 0 (no wait). Cap 1500ms.",
        ),
      maxBytes: z
        .number()
        .int()
        .min(500)
        .max(MAX_MAX_BYTES)
        .optional()
        .describe(
          "Max output byte budget; truncated past this. Defaults to 30000.",
        ),
      maxNodes: z
        .number()
        .int()
        .min(50)
        .max(20_000)
        .optional()
        .describe(
          "Hard cap on the number of nodes in the snapshot. Default 4000.",
        ),
    }),
    isReadOnly: true,
    // Snapshot mutates `data-xgoose-id` attributes and a module-level
    // registry; running two snapshots concurrently would scramble the IDs.
    isConcurrencySafe: () => false,
    label: (i) => {
      const fmt = String(i?.format ?? "text");
      const sel = i?.selector ? ` ${truncate(String(i.selector), 28)}` : "";
      return `Read page semantic ${fmt}${sel}`;
    },
    execute: async ({
      format,
      selector,
      includeHidden,
      scopeToModal,
      waitForStableMs,
      maxBytes,
      maxNodes,
    }) => {
      const outFormat = format ?? "text";
      const max = maxBytes ?? DEFAULT_MAX_BYTES;
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

      if (waitForStableMs && waitForStableMs > 0) {
        await awaitDomQuiet({
          debounceMs: Math.min(waitForStableMs, MAX_WAIT_FOR_STABLE_MS),
          maxWaitMs: MAX_WAIT_FOR_STABLE_MS,
        });
      }

      const snapshot: DomSnapshot = buildDomSnapshot(root, {
        includeHidden,
        scopeToModal,
        maxNodes,
      });

      if (outFormat === "json") {
        const json = JSON.stringify(snapshot);
        if (json.length > max) {
          // Drop the heaviest field (nodes) and surface roots + counts so the
          // agent can decide to narrow the selector and re-call.
          const slim = {
            url: snapshot.url,
            title: snapshot.title,
            rootIds: snapshot.rootIds,
            nodeCount: Object.keys(snapshot.nodes).length,
            modalScoped: snapshot.modalScoped,
            prunedCount: snapshot.prunedCount,
          };
          return {
            ok: true,
            format: outFormat,
            truncated: true,
            sizeBytes: json.length,
            preview: slim,
            hint: "json exceeded maxBytes — pass a tighter selector or lower maxNodes",
          };
        }
        return { ok: true, format: outFormat, snapshot };
      }

      const text = renderText(snapshot);
      if (text.length > max) {
        return {
          ok: true,
          format: outFormat,
          truncated: true,
          sizeBytes: text.length,
          modalScoped: snapshot.modalScoped,
          preview: text.slice(0, max) + "\n…[truncated]",
        };
      }
      return {
        ok: true,
        format: outFormat,
        ...(snapshot.modalScoped ? { modalScoped: true } : {}),
        ...(snapshot.prunedCount ? { prunedCount: snapshot.prunedCount } : {}),
        text,
      };
    },
  });
}
