// Pure-JS, no-esbuild bundler for dynamically-installed user skills.
//
// The canonical authoring pattern (per SKILL_AUTHORING.md) is:
//
//   // ==XGooseSkill==
//   // …
//   // ==/XGooseSkill==
//
//   import { defineSkill, fn } from '@xgoose/skill';
//   import { z } from 'zod';
//
//   /* … helper code, no further imports … */
//
//   export default defineSkill({ … });
//
// `build-skills.mjs` (Node side) uses esbuild to turn that into a self-
// contained IIFE for built-in skills. Doing the same in an MV3 service
// worker would require shipping ~11 MB of esbuild-wasm, which is heavier
// than every other extension asset combined.
//
// Instead we lean on the fact that the body is already plain JS (TS is
// allowed but rarely used in skills). The transformation is:
//
//   1. Strip the two known bare-spec import lines (`@xgoose/skill`, `zod`).
//   2. Find the first top-level `export default <expr>;` and rewrite it
//      to `__xgoose_skill_module__ = { default: <expr> };`.
//   3. Wrap the rewritten body in an IIFE that pulls `defineSkill`, `fn`,
//      and `z` off `window.__xgooseSkillRuntime` (mounted by
//      `dist/skillRuntime.js`, injected on-demand by `skillInjector.ts`).
//   4. Wrap that with the standard install boilerplate (detect gate, meta
//      stamp, `window.xgoose.skills[<ns>] = Object.assign(…)`), byte-for-
//      byte identical to what `build-skills.mjs` emits for built-ins.
//
// Edge cases this deliberately rejects (with a descriptive error so the
// agent can fix the skill before saving an unusable artifact):
//   - Missing `export default`.
//   - More than one top-level `export default` (multi-default is a TS error
//     anyway; we surface it eagerly).
//   - Any `import` that isn't `@xgoose/skill` or `zod`. The skill runtime
//     doesn't currently expose anything else; surfacing it at install time
//     beats a confusing `ReferenceError` at first call.
//   - `require(...)` calls — same reasoning, CommonJS isn't supported.

import type { SkillHeader } from "@xgoose/skill-runtime";

const SKILL_IMPORT_RE =
  /^\s*import\s*\{([^}]+)\}\s*from\s*['"]@xgoose\/skill['"];?\s*$/gm;
const ZOD_IMPORT_RE = /^\s*import\s*\{([^}]+)\}\s*from\s*['"]zod['"];?\s*$/gm;
const OTHER_IMPORT_RE = /^\s*import\s.+?from\s+['"][^'"]+['"];?\s*$/gm;
const REQUIRE_RE = /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/;
// Match `export default` only when it sits at the start of a line (allowing
// indent). This isn't a real JS tokenizer, but it survives the canonical
// authoring pattern; anything fancier should be published via xgoose-web's
// esbuild-wasm flow.
const EXPORT_DEFAULT_RE = /^[ \t]*export\s+default\s+/gm;

export interface BundleResult {
  bundled: string;
}

/**
 * Bundle a user-skill body into the install-ready IIFE string. Throws
 * with a single-sentence message on validation failure so the SW can
 * surface it via the `sw:edit_skill` reply.
 */
export function bundleUserSkill(
  body: string,
  header: SkillHeader,
): BundleResult {
  const sanitized = body
    .replace(SKILL_IMPORT_RE, "")
    .replace(ZOD_IMPORT_RE, "");

  const stray = OTHER_IMPORT_RE.exec(sanitized);
  if (stray) {
    OTHER_IMPORT_RE.lastIndex = 0;
    throw new Error(
      `unsupported import: ${stray[0].trim()} — only ` +
        `'@xgoose/skill' and 'zod' are available in user skills`,
    );
  }
  OTHER_IMPORT_RE.lastIndex = 0;

  const req = REQUIRE_RE.exec(sanitized);
  if (req) {
    throw new Error(
      `unsupported CommonJS require: ${req[0]} — skills must use ES module imports`,
    );
  }

  const matches = [...sanitized.matchAll(EXPORT_DEFAULT_RE)];
  if (matches.length === 0) {
    throw new Error(
      "skill body has no `export default` — the canonical shape is " +
        "`export default defineSkill({ … });`",
    );
  }
  if (matches.length > 1) {
    throw new Error(
      "skill body has more than one `export default` statement; only one is allowed",
    );
  }
  const m = matches[0];
  const before = sanitized.slice(0, m.index ?? 0);
  let after = sanitized.slice((m.index ?? 0) + m[0].length);

  // Trim the trailing `;` (and surrounding whitespace/comments) that
  // terminates the `export default <expr>;` statement. Leaving the `;`
  // inside the synthesized parens would yield invalid JS:
  //   `__xgoose_skill_module__ = { default: (defineSkill({…});\n) };`
  //
  // The export default value is always an expression, so it has at most
  // one terminating semicolon; we strip exactly that one and re-emit it
  // outside the parens.
  {
    let trim = after.replace(/[\s\r\n]+$/, "");
    // Allow trailing `// …` or `/* … */` comments to live after the `;`.
    // We keep them appended at the end of the file for readability.
    while (true) {
      const lineCmt = /[ \t]*\/\/[^\n]*$/m.exec(trim);
      const blockCmt = /[ \t]*\/\*[\s\S]*?\*\/\s*$/m.exec(trim);
      const c =
        lineCmt && (!blockCmt || lineCmt.index! > blockCmt.index!)
          ? lineCmt
          : blockCmt;
      if (!c || c.index! + c[0].length !== trim.length) break;
      trim = trim.slice(0, c.index).replace(/[\s\r\n]+$/, "");
    }
    if (trim.endsWith(";")) trim = trim.slice(0, -1).replace(/[\s\r\n]+$/, "");
    after = trim;
  }

  const rewrittenBody =
    before + "__xgoose_skill_module__ = { default: (" + after + ") };";

  const detectExpr =
    typeof header.detect === "string" && header.detect.trim()
      ? header.detect.trim()
      : "true";
  const nsJson = JSON.stringify(header.namespace);
  const meta = JSON.stringify({
    name: header.name,
    namespace: header.namespace,
    primary: header.primary,
  });

  // Two-space indent is purely cosmetic; diffs between versions stay
  // reviewable. Layout mirrors `xgoose-web/worker/src/skills/bundler.ts`
  // and `build-skills.mjs`'s `wrapForBrowser` so the storage shape is
  // homogeneous across built-in vs user-installed skills.
  const lines: string[] = [
    ";(function () {",
    `  try { if (!(${detectExpr})) return; } catch (_) { return; }`,
    `  globalThis.__XGOOSE_SKILL_META__ = ${meta};`,
    `  var __runtime = window.__xgooseSkillRuntime;`,
    `  if (!__runtime) {`,
    `    console.warn('[xgoose] user-skill ${JSON.stringify(header.name).slice(1, -1)} skipped: skillRuntime.js was not injected before this skill');`,
    `    return;`,
    `  }`,
    `  var __xgoose_skill_module__ = null;`,
    `  (function () {`,
    `    var defineSkill = __runtime.defineSkill;`,
    `    var fn = __runtime.fn;`,
    `    var z = __runtime.z;`,
    indent(rewrittenBody, 4),
    `  })();`,
    `  var w = window;`,
    `  w.xgoose = w.xgoose || { skills: {} };`,
    `  w.xgoose.skills = w.xgoose.skills || {};`,
    `  var __skill__ = (__xgoose_skill_module__ && __xgoose_skill_module__.default) || null;`,
    `  if (__skill__ && typeof __skill__ === 'object') {`,
    `    w.xgoose.skills[${nsJson}] = __skill__;`,
    `  }`,
    "})();",
    "",
  ];
  return { bundled: lines.join("\n") };
}

function indent(s: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return s
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

/**
 * Best-effort extract a hostname from a `@match` pattern so the
 * introspection environment can satisfy `@detect` checks that consult
 * `location.hostname`. Returns null if the match list is empty or has no
 * concrete host segment.
 */
function extractHostnameFromMatch(matches: string[]): string | null {
  for (const m of matches) {
    const mm = /^[*a-z]+:\/\/(?:\*\.)?([^/*]+)/i.exec(m);
    if (mm) return mm[1];
  }
  return null;
}

/**
 * Static analysis pass: walk the (post-stripped) skill body and extract
 * each `<name>: fn({ summary: '…', … })` entry inside the
 * `export default defineSkill({ … })` block.
 *
 * Why static rather than runtime introspection: MV3 service workers and
 * extension pages both enforce `script-src 'self'`, which blocks
 * `new Function`/`eval`. Running the bundled IIFE in a sandbox to call
 * `__describe__()` isn't available to us here.
 *
 * Coverage is intentionally narrow — we match the canonical authoring
 * pattern documented in SKILL_AUTHORING.md and used by every existing
 * skill. Skills that bury `fn(…)` calls behind helper functions will end
 * up with an empty summary list and a slightly less informative
 * `list_skills` card; the agent can still drive them via `read_skill` +
 * `js_exec` against the bundled IIFE. We treat empty summaries as non-fatal.
 */
export function introspectFunctions(
  bundled: string,
  header: SkillHeader,
): Array<{
  name: string;
  summary: string;
  signature: string;
  invocation: string;
  primary: boolean;
}> {
  // The bundled blob includes the wrapper boilerplate but also the body
  // verbatim, so we can grep over it. Use the original body extraction:
  // the bundler emits `var defineSkill = __runtime.defineSkill;` and then
  // the user's body. Grabbing everything after that marker is more
  // forgiving than re-parsing the source.
  const marker = "var z = __runtime.z;";
  const idx = bundled.indexOf(marker);
  const haystack = idx >= 0 ? bundled.slice(idx + marker.length) : bundled;
  return introspectFromBody(haystack, header);
}

/** Inner helper exposed for tests. */
function introspectFromBody(
  body: string,
  header: SkillHeader,
): Array<{
  name: string;
  summary: string;
  signature: string;
  invocation: string;
  primary: boolean;
}> {
  // Locate the `export default defineSkill({ … })` block. After the
  // bundler runs, this becomes `__xgoose_skill_module__ = { default: (
  // defineSkill({ … }) ) };`. Either way, the spec object literal is the
  // first balanced `{ … }` that follows a `defineSkill(` token.
  const out: Array<{
    name: string;
    summary: string;
    signature: string;
    invocation: string;
    primary: boolean;
  }> = [];
  const defineIdx = body.search(/\bdefineSkill\s*\(/);
  if (defineIdx < 0) return out;
  const openParen = body.indexOf("(", defineIdx);
  if (openParen < 0) return out;
  // Skip whitespace + optional comment up to the first `{`.
  const openBrace = body.indexOf("{", openParen);
  if (openBrace < 0) return out;
  const specEnd = findMatchingBrace(body, openBrace);
  if (specEnd < 0) return out;
  const specText = body.slice(openBrace + 1, specEnd);

  // Walk top-level entries `<key>: fn({ … }),`. A top-level entry is one
  // whose `<key>:` token sits at brace-depth 0 of `specText`. Same logic
  // for finding the matching `)` of the `fn(...)` call.
  const len = specText.length;
  let i = 0;
  while (i < len) {
    // Skip whitespace, line comments, and block comments.
    i = skipTrivia(specText, i);
    if (i >= len) break;
    // Try to read an identifier or string literal as the key.
    const key = readKey(specText, i);
    if (!key) {
      // Advance past whatever token started here.
      i = skipToken(specText, i);
      continue;
    }
    let j = skipTrivia(specText, key.end);
    if (specText[j] !== ":") {
      i = skipToken(specText, key.end);
      continue;
    }
    j = skipTrivia(specText, j + 1);
    // Expect `fn(` next; if not, treat as non-fn entry and skip it.
    if (!specText.startsWith("fn", j)) {
      i = skipToken(specText, key.end);
      continue;
    }
    const lp = specText.indexOf("(", j);
    if (lp < 0) break;
    const rp = findMatchingParen(specText, lp);
    if (rp < 0) break;
    const fnArgs = specText.slice(lp + 1, rp);
    const fnObjOpen = fnArgs.indexOf("{");
    const fnObjEnd =
      fnObjOpen >= 0 ? findMatchingBrace(fnArgs, fnObjOpen) : -1;
    const fnObj =
      fnObjOpen >= 0 && fnObjEnd >= 0
        ? fnArgs.slice(fnObjOpen + 1, fnObjEnd)
        : fnArgs;
    const summary = extractStringField(fnObj, "summary") ?? "";
    const inputShape = extractInputShape(fnObj);
    out.push({
      name: key.name,
      summary,
      signature: `${key.name}(${inputShape}): any`,
      invocation: `await xgoose.skills.${header.namespace}.${key.name}({...})`,
      primary: !!header.primary && header.primary === key.name,
    });
    i = rp + 1;
  }
  return out;
}

// ── parser helpers (string-level; no JS engine required) ──────────────

function skipTrivia(s: string, i: number): number {
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === ",") {
      i++;
    } else if (c === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? n : nl + 1;
    } else if (c === "/" && s[i + 1] === "*") {
      const close = s.indexOf("*/", i + 2);
      i = close < 0 ? n : close + 2;
    } else {
      return i;
    }
  }
  return i;
}

function readKey(s: string, i: number): { name: string; end: number } | null {
  const c = s[i];
  if (c === '"' || c === "'") {
    const end = findStringEnd(s, i);
    if (end < 0) return null;
    return { name: s.slice(i + 1, end), end: end + 1 };
  }
  // Identifier start: letter, _, $.
  if (/[A-Za-z_$]/.test(c)) {
    let j = i + 1;
    while (j < s.length && /[A-Za-z0-9_$]/.test(s[j])) j++;
    return { name: s.slice(i, j), end: j };
  }
  return null;
}

function skipToken(s: string, i: number): number {
  // Skip over a single character so the outer loop makes progress.
  return Math.min(s.length, i + 1);
}

function findStringEnd(s: string, openIdx: number): number {
  const q = s[openIdx];
  let i = openIdx + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === q) return i;
    i++;
  }
  return -1;
}

function findMatchingBrace(s: string, openIdx: number): number {
  return findMatchingBracket(s, openIdx, "{", "}");
}

function findMatchingParen(s: string, openIdx: number): number {
  return findMatchingBracket(s, openIdx, "(", ")");
}

function findMatchingBracket(
  s: string,
  openIdx: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let i = openIdx;
  let inTemplate = 0;
  while (i < s.length) {
    const c = s[i];
    if (inTemplate > 0) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "`") {
        inTemplate--;
        i++;
        continue;
      }
      if (c === "$" && s[i + 1] === "{") {
        // Template literal substitution — recurse to find the matching '}'
        const sub = findMatchingBrace(s, i + 1);
        if (sub < 0) return -1;
        i = sub + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = findStringEnd(s, i);
      if (end < 0) return -1;
      i = end + 1;
      continue;
    }
    if (c === "`") {
      inTemplate++;
      i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? s.length : nl + 1;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      const close2 = s.indexOf("*/", i + 2);
      i = close2 < 0 ? s.length : close2 + 2;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function extractStringField(obj: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*:\\s*(['"\`])`);
  const m = re.exec(obj);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  if (obj[start] === "`") {
    const end = obj.indexOf("`", start + 1);
    return end < 0 ? null : obj.slice(start + 1, end);
  }
  const end = findStringEnd(obj, start);
  return end < 0 ? null : obj.slice(start + 1, end);
}

function extractInputShape(fnObj: string): string {
  // Pull the keys off `input: z.object({ <key>: …, … })` so the signature
  // shows arg names. Falls back to `args` when we can't read the shape.
  const m = /\binput\s*:\s*z\s*\.\s*object\s*\(\s*\{/.exec(fnObj);
  if (!m) return "args";
  const open = m.index + m[0].length - 1;
  const close = findMatchingBrace(fnObj, open);
  if (close < 0) return "args";
  const shape = fnObj.slice(open + 1, close);
  const keys: string[] = [];
  let i = 0;
  const n = shape.length;
  while (i < n) {
    i = skipTrivia(shape, i);
    if (i >= n) break;
    const k = readKey(shape, i);
    if (!k) {
      i = skipToken(shape, i);
      continue;
    }
    let j = skipTrivia(shape, k.end);
    if (shape[j] === ":") {
      keys.push(k.name);
      // Skip past this entry's value to the next comma at depth 0.
      j++;
      let depth = 0;
      while (j < n) {
        const c = shape[j];
        if (c === "{" || c === "(" || c === "[") {
          const closer =
            c === "{"
              ? findMatchingBrace(shape, j)
              : c === "("
                ? findMatchingParen(shape, j)
                : findMatchingBracket(shape, j, "[", "]");
          if (closer < 0) {
            j = n;
            break;
          }
          j = closer + 1;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          const end = c === "`" ? shape.indexOf("`", j + 1) : findStringEnd(shape, j);
          j = end < 0 ? n : end + 1;
          continue;
        }
        if (c === "," && depth === 0) break;
        j++;
      }
      i = j + 1;
    } else {
      i = skipToken(shape, k.end);
    }
  }
  if (keys.length === 0) return "args";
  return `{ ${keys.join(", ")} }`;
}
