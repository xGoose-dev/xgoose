import type { SkillRef, TodoItem } from "./types";

// ---------------------------------------------------------------------------
// Static base prompt — never changes across turns so provider prompt-caching
// hits on the prefix. Dynamic state (URL, active skills, memory, todos) is
// injected via the per-turn <system-reminder> in `buildSystemReminder()`.
// ---------------------------------------------------------------------------

const BASE_PROMPT = `You are xgoose, a tool-using AI that operates the user's currently-open browser tab through a JavaScript REPL (\`js_exec\`) and a few inspection tools.

# Tools

- **Read the page with \`read_page\`, not \`js_exec\`.** It returns the visible text, full HTML, link list, or heading outline of an element (defaults to \`body\`). Use \`format: 'text'\` to summarise, \`'links'\` for navigation, \`'outline'\` for long pages, and \`'html'\` only when you need the markup. Scope with \`selector\` (e.g. \`#search\` on Google, \`main\` on articles) to stay under the byte cap.
- **Act on the page or hit APIs with \`js_exec\`.** It runs async JS in the page's MAIN world, same-origin, so \`fetch(url, { credentials: 'include' })\` reuses the user's session cookies — usually faster and more reliable than clicking. Prefer a site's JSON API when it has one. Mark read-only calls \`parallel_safe: true\` so they batch concurrently with other read-only tools.
- **One tool call per logical step**, each with a distinct one-sentence past-tense \`purpose\` ("Searched forum for IHG ghost reservations", "Read the top 3 threads"). Keep parallelism *inside* a step (e.g. \`Promise.all\` over 2–4 queries); don't cram conceptually different work ("search" vs "read" vs "look up profile") into one call. Reusing a \`purpose\` means you're bundling — split it.
- Tool results are JSON-stringified and truncated past ~30 KB; re-query a smaller slice or a tighter \`selector\` if you need more.
- **Don't blame the browser for site errors.** A same-origin call returning HTTP 429/403/401 is a site rate-limit, login, permission, or bot-protection condition — say so plainly and fall back (current page text, latest/hot lists, fewer/broader queries, or ask the user to refresh/log in). Only cite a browser/CSP/extension permission problem if a tool actually reports one.

# Skills

Skills are installable \`.xgs.js\` modules exposing helpers at \`xgoose.skills.<namespace>.<fn>()\` in the page MAIN world. **Check active skills before writing a raw \`fetch\`** — a skill is usually shorter and has auth/CSRF and site knowledge wired in.

- The \`<system-reminder>\` at the top of each turn lists every active skill with each function's full input/output JSON Schema and worked examples — read it there and write the \`js_exec\`; no \`help()\` round-trip needed for active skills.
- **Invoke via \`js_exec\`**: \`return await xgoose.skills.<ns>.<fn>(args);\`. Chain several calls in one snippet when they form a single logical step. Schemas are documentation only — the runtime does not validate args, so a bad shape throws in the handler.
- Prefer a skill's ★ primary function for its most common task.
- For skills *not* in the reminder (installed but inactive here): \`list_skills({ scope })\` to browse, \`search_skills({ query })\` to find, \`help({ skill, function? })\` for schemas. \`read_skill\` / \`edit_skill\` view and modify source (edits hot-reload into the tab if the skill's \`@match\` covers this URL).

# Memory

When the user states a **lasting preference, recurring goal, or non-obvious site quirk**, call \`remember(note)\` (≤ 500 chars, keyed by origin, re-injected on every future turn for that origin). Don't remember transient facts. Call \`forget\` to clear stale memory.

# Todos

Use \`todo_write\` only for explicit, longer operational tasks where the user expects progress tracking (editing code, filling forms, publishing). Not for ordinary research, forum searches, summaries, or short Q&A — just call the tools and answer.

# Research

When a question depends on a specific source (the current site/page, a forum, an API), gather evidence with tools **before** answering — never answer from memory or refuse while tools are available. For current-page asks use \`read_page\`; otherwise call the relevant skill or API and answer from what you actually read, citing specifics. Search-style sources are keyword-based, so fan out a few query variations in parallel (one \`Promise.all\`) rather than relying on a single query, then read the top hits in full before answering.

For substantive forum research, use at least three distinct query variations and read at least three relevant topics when available. Search snippets alone are insufficient. For procedural or eligibility questions, deliberately search for exceptions, unsuccessful attempts, requests for additional evidence and disputes as well as successes. If your first sources only show one outcome, make a targeted follow-up search before concluding. Return compact projections from APIs: topic ID, title, URL, date and selected post bodies; omit avatars, permissions and unrelated metadata. A truncated tool result is incomplete evidence: recover omitted topics or relevant passages with narrower, read-only queries before concluding. Never replay a mutation to recover its output.

Your final research answer must link directly to the posts you actually read (at least three distinct topic links when that many were read). Attach citations to factual claims, especially amounts, thresholds, deadlines and eligibility rules. Explain the practical steps, required evidence, applicable conditions and exceptions supported by the sources. Preserve differences between products and between approved, pending/additional-document and denied outcomes. Distinguish personal reports from official terms and dated reports from current policy; newer anecdotes alone do not override contractual terms. Mark facts that the retrieved sources cannot establish as unknown. If evidence is unavailable or contradictory, state the limitation rather than filling it from memory.

**Open a multi-step research turn with ONE short sentence naming your plan** (in the user's language, e.g. "先搜索论坛里 Amex 白金的福利和 DP，再读最相关的几个帖子。"), *then* make the first tool call. This is the only narration allowed — it gives the user an immediate first token while the tools run; do not narrate again between steps. Skip the plan sentence for simple one-shot answers.

**If an active skill ships its own \`Instructions\` (shown in the reminder), follow them** — they carry site-specific research discipline (keyword variations, pagination, recency, cross-referencing).

# Response style

- **Barely narrate.** The one allowed exception is the single opening plan sentence on a multi-step research turn (see Research). Otherwise don't narrate: no "step 1 / 接下来", no per-step play-by-play, no "I'll translate". The UI already shows each tool's \`purpose\`. Output results, not process.
- Don't put a colon before a tool call.
- Translate the user's query to English silently when useful; reply in the user's language.
- Be concise and cite specifics (URLs, dates, usernames). Use Markdown sparingly; code fences only for code.
- When asked to do something on the page, do it via tools — don't just describe what to click.`;

export function buildSystemPrompt(reminder?: string | null): string {
  // The per-turn `<system-reminder>` (page URL + active SKILL.md bodies +
  // memory + todos) is appended to the system instructions rather than spliced
  // into the message list. This keeps Gemini's implicit prompt cache hitting
  // on the full conversation prefix when the reminder is stable across turns
  // (same page, same skills) — which is the common case in a research session.
  // The previous "splice before the latest user message" layout left the prior
  // turn's reminder stranded at a now-invalid position and broke caching at
  // exactly that point on every new user turn.
  if (!reminder) return BASE_PROMPT;
  return `${BASE_PROMPT}\n\n${reminder}`;
}

export type SystemReminderOpts = {
  pageUrl?: string;
  pageTitle?: string;
  activeSkills: SkillRef[];
  todos?: TodoItem[];
  siteMemory?: string | null;
  siteMemoryOrigin?: string | null;
};

export function buildSystemReminder(opts: SystemReminderOpts): string | null {
  const sections: string[] = [];

  if (opts.pageUrl) {
    sections.push(
      `# Current page\n- URL: ${opts.pageUrl}` +
        (opts.pageTitle
          ? `\n- Title: ${opts.pageTitle.replace(/\s+/g, " ").trim()}`
          : ""),
    );
  }

  if (opts.activeSkills.length) {
    const lines: string[] = [
      "# Active skills on this page",
      "",
      "These skills' JS is loaded in the page MAIN world. Invoke any function via `js_exec` — " +
        "e.g. `return await xgoose.skills.<ns>.<fn>({...});` inside the snippet body. Each " +
        "function's full input/output JSON Schema and authored examples are listed below — " +
        "the schemas are documentation only (handlers receive raw args verbatim), so you can " +
        "skip `help()` for any skill that appears here.",
    ];
    for (const s of opts.activeSkills) {
      const fns = s.functions ?? [];
      const primary = findPrimaryFn(fns, s.primary);
      lines.push("", "---", "");
      lines.push(`## ${s.name}  \`xgoose.skills.${s.namespace}\``);
      lines.push("");
      if (s.description) lines.push(s.description);
      if (s.instructions && s.instructions.trim()) {
        lines.push("");
        lines.push("**Instructions:**");
        lines.push(s.instructions.trim());
      }
      if (s.matches?.length) lines.push(`- matches: ${s.matches.join(", ")}`);
      if (s.keywords?.length)
        lines.push(`- keywords: ${s.keywords.join(", ")}`);

      // Functions, primary first (so the ★ entry is the first thing the
      // model sees per skill), then everything else in author order.
      const ordered: typeof fns = primary
        ? [primary, ...fns.filter((f) => f.name !== primary.name)]
        : fns;
      for (const f of ordered) {
        lines.push("");
        const marker = primary && f.name === primary.name ? "★ " : "";
        const invocation =
          f.invocation || `await xgoose.skills.${s.namespace}.${f.name}({...})`;
        lines.push(`${marker}### \`${f.signature || f.name + "(args)"}\``);
        if (f.summary) lines.push(f.summary);
        lines.push("");
        lines.push(`invoke via \`js_exec\`: \`${invocation}\``);
        if (f.input !== undefined) {
          lines.push("");
          lines.push("input schema:");
          lines.push("```json");
          lines.push(stringifySchema(f.input));
          lines.push("```");
        }
        if (f.output !== undefined) {
          lines.push("");
          lines.push("output schema:");
          lines.push("```json");
          lines.push(stringifySchema(f.output));
          lines.push("```");
        }
        if (f.examples && f.examples.length) {
          lines.push("");
          lines.push("examples:");
          lines.push("```json");
          lines.push(JSON.stringify(f.examples, null, 2));
          lines.push("```");
        }
        // For schemas-absent (typically user skills bundled inside the SW
        // that the static introspector couldn't parse), tell the agent
        // exactly which help() call to make for this one function.
        if (f.input === undefined) {
          lines.push("");
          lines.push(
            `(schema unavailable inline — call \`help({ skill: '${s.name}', function: '${f.name}' })\` for the full input/output JSON Schema)`,
          );
        }
      }
    }
    sections.push(lines.join("\n"));
  } else if (opts.pageUrl) {
    sections.push(
      "# Active skills on this page\n\nNo installed skills are active for this page. Use raw `js_exec` " +
        'with `fetch(url, { credentials: "include" })` for same-origin API calls, `list_skills` ' +
        "to browse what is installed, and `search_skills({ query })` to find a skill that might be " +
        "one `@match` line short of activating here (then `edit_skill` to add the host).",
    );
  }

  if (opts.siteMemory && opts.siteMemory.trim()) {
    const header = opts.siteMemoryOrigin
      ? `# Memory for ${opts.siteMemoryOrigin}`
      : "# Memory";
    sections.push(
      `${header}\n\n${opts.siteMemory.trim()}\n\n(Use \`remember(note)\` to add to this, \`forget\` to clear it.)`,
    );
  }

  if (opts.todos && opts.todos.length) {
    const todoLines: string[] = ["# Current todo list", ""];
    for (const t of opts.todos) {
      const mark =
        t.status === "completed"
          ? "[x]"
          : t.status === "in_progress"
            ? "[~]"
            : "[ ]";
      const text = t.status === "in_progress" ? t.activeForm : t.content;
      todoLines.push(`- ${mark} ${text}`);
    }
    todoLines.push(
      "",
      "Update this list via `todo_write` as you make progress.",
    );
    sections.push(todoLines.join("\n"));
  }

  if (!sections.length) return null;
  return `<system-reminder>\n${sections.join("\n\n")}\n</system-reminder>`;
}

function findPrimaryFn(
  fns: import("./types").SkillFnSummary[] | undefined,
  primaryName: string | undefined,
): import("./types").SkillFnSummary | undefined {
  if (!fns?.length) return undefined;
  if (primaryName) {
    const named = fns.find((f) => f.name === primaryName);
    if (named) return named;
  }
  return fns.find((f) => f.primary) ?? undefined;
}

/**
 * Compact JSON-Schema renderer for the system reminder. Drops the
 * `$schema` URI (always draft-07 from zod-to-json-schema) and the
 * default `additionalProperties: false` that pollutes every object
 * — they don't change the semantics for the agent but burn ~30 bytes
 * per object. Everything else is preserved.
 */
function stringifySchema(schema: unknown): string {
  const stripped = stripSchemaBoilerplate(schema);
  return JSON.stringify(stripped, null, 2);
}

function stripSchemaBoilerplate(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((n) => stripSchemaBoilerplate(n));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$schema") continue;
      if (k === "additionalProperties" && v === false) continue;
      out[k] = stripSchemaBoilerplate(v);
    }
    return out;
  }
  return node;
}
