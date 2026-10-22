/**
 * Parser for the Tampermonkey-style `// ==XGooseSkill== … // ==/XGooseSkill==`
 * header block.
 *
 * This is the single source of truth for header parsing; it's used by:
 *
 *   - `scripts/build-skills.mjs`  — at build time, to validate frontmatter
 *     and emit `registry.json`
 *   - the extension's install-banner content script — at runtime, to
 *     detect skill files when the user opens a `.xgs.js` URL
 *   - the extension's install page — to preview/validate pasted or
 *     uploaded source before the user confirms
 *   - xgoose-web's worker — to ingest published skills
 *
 * The parser is intentionally permissive: it normalises whitespace,
 * accepts multi-line `@detect` continuations, treats `@all-frames` /
 * `@allFrames` as aliases, and preserves unknown directives in `extra`.
 * Validation happens via `SkillHeaderSchema.parse(...)` after parsing.
 */

import { SkillHeaderSchema, type SkillHeader } from "./types";

export const HEADER_START_RE = /^[ \t]*\/\/[ \t]*==XGooseSkill==[ \t]*$/m;
export const HEADER_END_RE = /^[ \t]*\/\/[ \t]*==\/XGooseSkill==[ \t]*$/m;
const DIRECTIVE_RE = /^[ \t]*\/\/[ \t]*@([\w-]+)[ \t]*(.*?)[ \t]*$/;

/**
 * Locate the header block in `source` and return its byte range plus the
 * raw lines between the markers. Returns `null` when no header is present
 * (so callers can short-circuit non-skill `.xgs.js` files).
 */
export function findHeader(source: string): {
  start: number;
  end: number;
  inner: string;
} | null {
  const startMatch = HEADER_START_RE.exec(source);
  if (!startMatch) return null;
  // Search for the end marker *after* the start marker.
  const tail = source.slice(startMatch.index + startMatch[0].length);
  const endMatch = HEADER_END_RE.exec(tail);
  if (!endMatch) return null;
  const start = startMatch.index;
  const end =
    startMatch.index +
    startMatch[0].length +
    endMatch.index +
    endMatch[0].length;
  const innerStart = startMatch.index + startMatch[0].length;
  const innerEnd = innerStart + endMatch.index;
  return { start, end, inner: source.slice(innerStart, innerEnd) };
}

/**
 * Parse the directives between `==XGooseSkill==` and `==/XGooseSkill==`.
 * Returns a raw record where each directive key maps to an array of
 * values (so repeated `@match` lines collect properly).
 */
export function parseDirectives(inner: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of inner.split(/\r?\n/)) {
    const m = DIRECTIVE_RE.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    if (!out[key]) out[key] = [];
    out[key].push(value);
  }
  return out;
}

/**
 * Map raw directive names + arrays onto the shape expected by
 * `SkillHeaderSchema`. Aliases (`run-at` → `runAt`, `all-frames` →
 * `allFrames`, `require` → `requires`, etc.) are resolved here.
 */
function buildHeaderObject(raw: Record<string, string[]>): unknown {
  const first = (k: string): string | undefined => raw[k]?.[0];
  const all = (k: string): string[] => raw[k] ?? [];

  const used = new Set<string>();
  const take = (...keys: string[]): string[] => {
    const out: string[] = [];
    for (const k of keys) {
      const v = raw[k];
      if (v) {
        out.push(...v);
        used.add(k);
      }
    }
    return out;
  };
  const takeOne = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = first(k);
      if (v !== undefined) {
        used.add(k);
        return v;
      }
    }
    return undefined;
  };

  const name = takeOne("name");
  const namespace = takeOne("namespace", "ns");
  const version = takeOne("version");
  const description = takeOne("description", "desc");
  const matches = take("match");
  const include = take("include");
  const exclude = take("exclude");
  const detect = takeOne("detect");
  const runAt = takeOne("run-at", "runAt");
  const allFrames = takeOne("all-frames", "allFrames");
  const requires = take("require", "requires");
  const connect = take("connect");
  const primary = takeOne("primary");
  const keywords = take("keyword", "keywords");
  const homepage = takeOne("homepage", "homepageURL");
  const author = takeOne("author");
  // `@action Label | prompt text` → { label, prompt }. Prompt-only (no JS)
  // from the header; richer JS actions come from the defineSkill body.
  const actions = take("action")
    .map((raw) => {
      const i = raw.indexOf("|");
      if (i < 0) return null;
      const label = raw.slice(0, i).trim();
      const prompt = raw.slice(i + 1).trim();
      if (!label || !prompt) return null;
      return { label, prompt };
    })
    .filter((a): a is { label: string; prompt: string } => a !== null);

  // Preserve everything else (unknown / vendor directives) so callers
  // can surface them in install previews and round-trip them on publish.
  const extra: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (used.has(k)) continue;
    extra[k] = [...v];
  }

  return {
    name,
    namespace,
    version,
    description,
    matches,
    include,
    exclude,
    detect,
    runAt,
    allFrames: allFrames === undefined ? undefined : /^true$/i.test(allFrames),
    requires,
    connect,
    primary,
    keywords,
    homepage,
    author,
    actions,
    extra,
  };
}

export interface ParsedSkillFile {
  header: SkillHeader;
  /** Inclusive byte range of the header block in `source`. */
  headerRange: { start: number; end: number };
  /** Everything after the header — what the bundler operates on. */
  body: string;
}

export class SkillHeaderError extends Error {
  readonly kind: "missing_header" | "unterminated_header" | "validation";
  constructor(
    kind: ParsedSkillFile extends never ? never : SkillHeaderError["kind"],
    message: string,
  ) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Top-level convenience: locate + parse + validate. Throws
 * `SkillHeaderError` with a structured `kind` so callers can produce
 * good error messages (e.g. the install banner ignores `missing_header`
 * silently but surfaces `validation` to the user).
 */
export function parseSkillFile(source: string): ParsedSkillFile {
  const located = findHeader(source);
  if (!located) {
    throw new SkillHeaderError(
      "missing_header",
      "No '// ==XGooseSkill==' block found in the source.",
    );
  }
  const directives = parseDirectives(located.inner);
  const candidate = buildHeaderObject(directives);
  const parsed = SkillHeaderSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new SkillHeaderError(
      "validation",
      `Invalid skill header — ${issues}`,
    );
  }
  return {
    header: parsed.data,
    headerRange: { start: located.start, end: located.end },
    body: source.slice(located.end).replace(/^\r?\n/, ""),
  };
}

/**
 * Re-emit a header block from a `SkillHeader` object. Used when the
 * server auto-bumps `@version` on publish: the registry rewrites the
 * `@version` line inside the canonical source so installs always pull
 * a `.xgs.js` whose header matches the assigned version.
 *
 * The order of directives mirrors what authors typically write, which
 * keeps diffs human-readable across republishes.
 */
export function renderHeader(header: SkillHeader): string {
  const lines: string[] = ["// ==XGooseSkill=="];
  const push = (key: string, value: string | undefined | null): void => {
    if (value === undefined || value === null || value === "") return;
    lines.push(`// @${pad(key)} ${value}`);
  };
  const pushMulti = (key: string, values: string[] | undefined): void => {
    if (!values) return;
    for (const v of values) {
      if (v) lines.push(`// @${pad(key)} ${v}`);
    }
  };

  push("name", header.name);
  push("namespace", header.namespace);
  push("version", header.version);
  push("description", header.description);
  if (header.author) push("author", header.author);
  if (header.homepage) push("homepage", header.homepage);
  pushMulti("match", header.matches);
  pushMulti("include", header.include);
  pushMulti("exclude", header.exclude);
  if (header.detect) push("detect", header.detect);
  push("run-at", header.runAt);
  if (header.allFrames) push("all-frames", "true");
  pushMulti("require", header.requires);
  pushMulti("connect", header.connect);
  if (header.primary) push("primary", header.primary);
  pushMulti("keyword", header.keywords);
  // Only prompt-only header actions round-trip here; `js` actions live in
  // the defineSkill body, not the header.
  for (const a of header.actions ?? []) {
    if (a.label && a.prompt && !a.js) {
      lines.push(`// @${pad("action")} ${a.label} | ${a.prompt}`);
    }
  }
  for (const [k, vs] of Object.entries(header.extra ?? {})) {
    for (const v of vs) lines.push(`// @${k} ${v}`);
  }
  lines.push("// ==/XGooseSkill==");
  return lines.join("\n");
}

function pad(k: string): string {
  // Visual alignment for typical key widths; not significant.
  const width = 12;
  return k.length >= width ? k : k + " ".repeat(width - k.length);
}

/**
 * Replace just the `@version` line in a `.xgs.js` source (preserving
 * everything else byte-for-byte). Used by the registry's auto-bump path
 * so the stored canonical source always agrees with the assigned
 * version. Returns `null` when there is no header (caller should fall
 * back to `parseSkillFile` + `renderHeader`).
 */
export function rewriteVersion(
  source: string,
  newVersion: string,
): string | null {
  const located = findHeader(source);
  if (!located) return null;
  const before = source.slice(0, located.start);
  const after = source.slice(located.end);
  const inner = located.inner.replace(
    /^([ \t]*\/\/[ \t]*@version[ \t]*).*$/m,
    `$1${newVersion}`,
  );
  // If there's no @version line yet, prepend one after the @namespace
  // (or after the start if no @namespace either).
  const innerFinal = /@version/.test(inner)
    ? inner
    : inner.replace(
        /^([ \t]*\/\/[ \t]*@namespace[ \t]+.*$)/m,
        `$1\n// @version      ${newVersion}`,
      );
  return (
    before + "// ==XGooseSkill==" + innerFinal + "// ==/XGooseSkill==" + after
  );
}
