// Pretty per-tool labels + result summaries for the chat panel's tool cards.
//
// The library ships labels for the universal tool set baked into
// `@xgoose/core` (`todo_write`, `remember`, `forget`) and
// `@xgoose/page-controller` (`page_info`, `read_page`, `js_exec`,
// `console_logs`, `network_requests`, `network_request`). Hosts that add
// their own tools (e.g. xgoose-safari's skill registry) call
// `registerToolLabels(...)` once at bootstrap to register matching
// describers + summarizers.
//
// `describeToolCall(name, input)`  → { icon, iconClass, title, subtitle }
//   Drives the tool-card header. For `js_exec` we surface the user-supplied
//   `purpose` as the title — that's the "summary of code" the user sees
//   while the tool is running.
//
// `summarizeToolResult(name, output)` → string
//   One-line summary written into the tool card subtitle once the tool
//   resolves. Falls back to a generic "done" / count.

export type ToolDescription = {
  icon: string;
  /** maps to .tool-ico.<iconClass> for color-coded backgrounds */
  iconClass: "search" | "browse" | "user" | "list" | "code" | "mem";
  title: string;
  subtitle: string;
};

export type ToolLabelEntry = {
  icon: string;
  iconClass: ToolDescription["iconClass"];
  label: string;
  /** If set, use the value of `input[argKey]` as the default subtitle. */
  argKey?: string;
  /** Custom call describer (overrides the default icon+label+argKey path). */
  describe?: (input: any, meta: ToolLabelEntry) => ToolDescription;
  /** Custom result summarizer (overrides the default "done" path). */
  summarize?: (output: any) => string;
};

// ── built-in labels ───────────────────────────────────────────────────────

const BASE_META: Record<string, ToolLabelEntry> = {
  search_web: {
    icon: "🌐", iconClass: "search", label: "Public web search · Exa", argKey: "query",
    summarize: output => `${output?.results?.length ?? 0} sources · $${((output?.charged_micros ?? 0)/1e6).toFixed(3)}`,
  },
  page_info: {
    icon: "🛈",
    iconClass: "browse",
    label: "Read page info",
    summarize: (output: any) => {
      const u = output?.url;
      return u ? hostnameOf(u) : "ok";
    },
  },
  read_page: {
    icon: "📄",
    iconClass: "browse",
    label: "Read page",
    argKey: "format",
    describe: (input, m) => ({
      icon: m.icon,
      iconClass: m.iconClass,
      title: `Read page ${String(input?.format ?? "text")}`,
      subtitle: input?.selector ? String(input.selector) : "body",
    }),
    summarize: (o: any) => {
      if (!o) return "ok";
      if (o.truncated) return `${formatBytes(o.sizeBytes ?? 0)} (truncated)`;
      if (typeof o.totalCount === "number") {
        const noun =
          o.format === "links"
            ? "link"
            : o.format === "outline"
              ? "heading"
              : "item";
        const ret = o.returnedCount ?? o.totalCount;
        const total = o.totalCount;
        return ret === total
          ? `${total} ${noun}${total === 1 ? "" : "s"}`
          : `${ret}/${total} ${noun}s`;
      }
      if (typeof o.text === "string") return `text · ${o.text.length} chars`;
      if (typeof o.html === "string")
        return `html · ${formatBytes(o.html.length)}`;
      return "ok";
    },
  },
  js_exec: {
    icon: "⚡",
    iconClass: "code",
    label: "Run JavaScript",
    describe: (input, m) => {
      const purpose = String(input?.purpose ?? "").trim();
      const parallel = input?.parallel_safe ? "parallel" : "serial";
      const sub: string[] = [parallel];
      if (input?.timeout_ms) sub.push(`timeout ${input.timeout_ms}ms`);
      if (Array.isArray(input?.args) && input.args.length) {
        sub.push(
          `${input.args.length} arg${input.args.length === 1 ? "" : "s"}`,
        );
      }
      return {
        icon: m.icon,
        iconClass: m.iconClass,
        title: purpose || "Ran JavaScript",
        subtitle: sub.join(" · "),
      };
    },
    summarize: (output: any) => {
      if (typeof output === "object" && output?.truncated) {
        return `result ${formatBytes(output.sizeBytes ?? 0)} (truncated)`;
      }
      const result = output?.result;
      if (Array.isArray(result)) return `array · ${result.length} items`;
      if (result && typeof result === "object")
        return `object · ${Object.keys(result).length} keys`;
      if (typeof result === "string") return `string · ${result.length} chars`;
      if (typeof result === "number" || typeof result === "boolean")
        return String(result);
      return "ok";
    },
  },
  console_logs: {
    icon: "🖥",
    iconClass: "list",
    label: "Read console logs",
    describe: (input, m) => {
      const parts: string[] = [];
      if (input?.levels?.length) parts.push(input.levels.join(","));
      if (input?.limit) parts.push(`limit ${input.limit}`);
      return {
        icon: m.icon,
        iconClass: m.iconClass,
        title: "Read console logs",
        subtitle: parts.join(" · ") || "recent entries",
      };
    },
    summarize: (output: any) =>
      Array.isArray(output) ? `${output.length} entries` : "ok",
  },
  network_requests: {
    icon: "🌐",
    iconClass: "list",
    label: "List network requests",
    describe: (input, m) => {
      const parts: string[] = [];
      if (input?.filter) parts.push(`filter:${input.filter}`);
      if (input?.limit) parts.push(`limit ${input.limit}`);
      return {
        icon: m.icon,
        iconClass: m.iconClass,
        title: "List network requests",
        subtitle: parts.join(" · ") || "recent requests",
      };
    },
    summarize: (output: any) =>
      Array.isArray(output) ? `${output.length} requests` : "ok",
  },
  network_request: {
    icon: "🔎",
    iconClass: "list",
    label: "Read network request detail",
    argKey: "id",
    describe: (input, m) => ({
      icon: m.icon,
      iconClass: m.iconClass,
      title: `Read network ${input?.part ?? "detail"}`,
      subtitle: input?.id ? `id ${input.id}` : "",
    }),
  },
  todo_write: {
    icon: "✓",
    iconClass: "list",
    label: "Update todo list",
    describe: (input, m) => {
      const n = Array.isArray(input?.todos) ? input.todos.length : 0;
      const inProg = (input?.todos as any[] | undefined)?.find(
        (t) => t?.status === "in_progress",
      );
      return {
        icon: m.icon,
        iconClass: m.iconClass,
        title: `Updated ${n}-item todo list`,
        subtitle: inProg
          ? `now: ${truncate(String(inProg.activeForm ?? inProg.content), 60)}`
          : "",
      };
    },
    summarize: (output: any) => `${output?.count ?? 0} items`,
  },
  remember: {
    icon: "💾",
    iconClass: "mem",
    label: "Remember",
    describe: (input, m) => ({
      icon: m.icon,
      iconClass: m.iconClass,
      title: "Remember",
      subtitle: input?.note ? truncate(String(input.note), 70) : "",
    }),
    summarize: (output: any) =>
      output?.origin ? `saved to ${output.origin}` : "ok",
  },
  forget: {
    icon: "🗑",
    iconClass: "mem",
    label: "Forget site memory",
    summarize: (output: any) =>
      output?.origin ? `saved to ${output.origin}` : "ok",
  },
};

// ── host-supplied extensions ──────────────────────────────────────────────

const CUSTOM_META: Record<string, ToolLabelEntry> = {};

/**
 * Merge `extras` into the tool-label registry. Hosts call this once at
 * content-script bootstrap to register labels for their host-specific
 * tools (e.g. xgoose-safari's `skill_call`, `help`, `read_skill`). Later
 * calls overwrite earlier entries for the same key.
 */
export function registerToolLabels(
  extras: Record<string, ToolLabelEntry>,
): void {
  Object.assign(CUSTOM_META, extras);
}

function metaFor(name: string): ToolLabelEntry | undefined {
  return CUSTOM_META[name] ?? BASE_META[name];
}

// ── public API ────────────────────────────────────────────────────────────

export function describeToolCall(name: string, input: any): ToolDescription {
  const meta = metaFor(name);
  if (meta?.describe) return meta.describe(input, meta);
  if (meta) {
    const argVal = meta.argKey ? input?.[meta.argKey] : undefined;
    return {
      icon: meta.icon,
      iconClass: meta.iconClass,
      title: meta.label,
      subtitle: argVal !== undefined && argVal !== null ? String(argVal) : "",
    };
  }
  return { icon: "⚙", iconClass: "list", title: name, subtitle: "" };
}

export function summarizeToolResult(name: string, output: any): string {
  if (output == null) return "no data";
  if (typeof output === "object" && output?.ok === false) {
    return `error: ${truncate(String(output.error ?? "unknown"), 60)}`;
  }
  const meta = metaFor(name);
  if (meta?.summarize) return meta.summarize(output);
  return "done";
}

// ── helpers ──────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
