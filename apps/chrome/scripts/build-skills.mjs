#!/usr/bin/env node
// Ports xgoose-safari/scripts/build-skills.mjs verbatim — same pipeline,
// same registry shape, same wrapper IIFE, so the .xgs.js artifacts are
// byte-identical across hosts. Only the input/output paths differ:
//
//   - SRC:     <repo>/skills/*.xgs.js       (authored source)
//   - OUT:     <repo>/dist/skills/<name>.xgs.js + registry.json
//   - RUNTIME: node_modules/@xgoose/skill-runtime/src/index.ts (file: dep,
//              resolves to the workspace package's actual TS source)
//
// Skill authors `import { defineSkill, fn } from '@xgoose/skill'`. The
// esbuild plugin below aliases that bare specifier to the runtime entry
// so we don't depend on a real npm package named `@xgoose/skill`.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const SRC = path.join(REPO, 'skills');
const OUT = path.join(REPO, 'dist', 'skills');
const RUNTIME = path.resolve(REPO, '../../packages/skill-runtime/src/index.ts');

const xgooseSkillAlias = {
  name: 'xgoose-skill-alias',
  setup(b) {
    b.onResolve({ filter: /^@xgoose\/skill$/ }, () => ({ path: RUNTIME }));
  },
};

const HEADER_START_RE = /^[ \t]*\/\/[ \t]*==XGooseSkill==[ \t]*$/m;
const HEADER_END_RE = /^[ \t]*\/\/[ \t]*==\/XGooseSkill==[ \t]*$/m;
const DIRECTIVE_RE = /^[ \t]*\/\/[ \t]*@([\w-]+)[ \t]*(.*?)[ \t]*$/;

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  if (!fs.existsSync(SRC)) {
    fs.writeFileSync(path.join(OUT, 'registry.json'), '[]');
    console.log('[build-skills] no skills/ source dir; wrote empty registry');
    return 0;
  }

  const skillFiles = fs
    .readdirSync(SRC, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.xgs.js'))
    .map((d) => path.join(SRC, d.name))
    .sort();

  const registry = [];
  let failures = 0;

  for (const file of skillFiles) {
    try {
      const entry = await buildOne(file);
      registry.push(entry);
    } catch (err) {
      failures++;
      console.error(
        `[build-skills] FAILED ${path.basename(file)}: ${err?.message ?? err}`,
      );
    }
  }

  fs.writeFileSync(
    path.join(OUT, 'registry.json'),
    JSON.stringify(registry, null, 2),
  );
  console.log(
    `[build-skills] wrote registry.json with ${registry.length} skill${
      registry.length === 1 ? '' : 's'
    }` + (failures ? ` (${failures} failed)` : ''),
  );

  // Ship the authoring spec into the extension's web-accessible
  // resources so the agent can fetch it on demand via
  // `chrome.runtime.getURL('skills/SKILL_AUTHORING.md')` when it decides
  // to write or edit a skill. Bundling the 18 KB doc into content.js
  // would inflate every page load; this keeps it lazy.
  const docSrc = path.join(SRC, 'SKILL_AUTHORING.md');
  if (fs.existsSync(docSrc)) {
    fs.copyFileSync(docSrc, path.join(OUT, 'SKILL_AUTHORING.md'));
    console.log('[build-skills] copied SKILL_AUTHORING.md');
  } else {
    console.warn('[build-skills] WARN: skills/SKILL_AUTHORING.md missing');
  }
  return failures ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[build-skills] fatal', err);
    process.exit(1);
  },
);

async function buildOne(file) {
  const source = fs.readFileSync(file, 'utf8');
  const { header, body, headerText } = parseSkillSource(source);
  const esm = await bundleBody({ body, entryHint: file, format: 'esm' });
  const { functions: fnSummaries, bodyActions, instructions } = await introspectBundle(esm, header);
  const actions = mergeActions(header.actions, bodyActions);
  const iife = await bundleBody({
    body,
    entryHint: file,
    format: 'iife',
    globalName: '__xgoose_skill_module__',
  });
  const wrapped = wrapForBrowser({ header, iifeBody: iife });
  const finalSource = headerText + '\n' + wrapped;
  const name = header.name;
  fs.writeFileSync(path.join(OUT, `${name}.xgs.js`), finalSource);
  const sha = createHash('sha256').update(finalSource).digest('hex');
  console.log(
    `[build-skills] built ${name} (${header.namespace}, ${fnSummaries.length} fn, ${(
      finalSource.length / 1024
    ).toFixed(1)} KB)`,
  );
  return {
    ...header,
    filePath: `skills/${name}.xgs.js`,
    sha,
    functions: fnSummaries,
    actions,
    ...(instructions ? { instructions } : {}),
  };
}

function mergeActions(headerActions, bodyActions) {
  const byLabel = new Map();
  for (const a of headerActions ?? []) {
    if (a && a.label && a.prompt) byLabel.set(a.label, { label: a.label, prompt: a.prompt });
  }
  for (const a of bodyActions ?? []) {
    if (a && a.label && a.prompt) {
      byLabel.set(a.label, {
        ...(a.id ? { id: a.id } : {}),
        label: a.label,
        prompt: a.prompt,
        ...(a.js ? { js: a.js } : {}),
      });
    }
  }
  return [...byLabel.values()];
}

function parseSkillSource(source) {
  const startMatch = HEADER_START_RE.exec(source);
  if (!startMatch) throw new Error('no `// ==XGooseSkill==` header');
  const after = source.slice(startMatch.index + startMatch[0].length);
  const endMatch = HEADER_END_RE.exec(after);
  if (!endMatch)
    throw new Error('header opened but never closed (`==/XGooseSkill==`)');
  const headerText = source.slice(
    startMatch.index,
    startMatch.index +
      startMatch[0].length +
      endMatch.index +
      endMatch[0].length,
  );
  const inner = after.slice(0, endMatch.index);
  const raw = {};
  for (const line of inner.split(/\r?\n/)) {
    const m = DIRECTIVE_RE.exec(line);
    if (!m) continue;
    (raw[m[1]] ??= []).push(m[2]);
  }
  const header = buildHeaderObject(raw);
  validateHeader(header);
  const body = source
    .slice(
      startMatch.index +
        startMatch[0].length +
        endMatch.index +
        endMatch[0].length,
    )
    .replace(/^\r?\n/, '');
  return { header, body, headerText };
}

function buildHeaderObject(raw) {
  const used = new Set();
  const takeOne = (...keys) => {
    for (const k of keys) {
      const v = raw[k]?.[0];
      if (v !== undefined) {
        used.add(k);
        return v;
      }
    }
    return undefined;
  };
  const take = (...keys) => {
    const out = [];
    for (const k of keys) {
      if (raw[k]) {
        out.push(...raw[k]);
        used.add(k);
      }
    }
    return out;
  };
  const allFrames = takeOne('all-frames', 'allFrames');
  const actions = take('action')
    .map((raw) => {
      const i = raw.indexOf('|');
      if (i < 0) return null;
      const label = raw.slice(0, i).trim();
      const prompt = raw.slice(i + 1).trim();
      return label && prompt ? { label, prompt } : null;
    })
    .filter(Boolean);
  const out = {
    name: takeOne('name'),
    namespace: takeOne('namespace', 'ns'),
    version: takeOne('version') ?? '0.0.0',
    description: takeOne('description', 'desc') ?? '',
    matches: take('match'),
    include: take('include'),
    exclude: take('exclude'),
    detect: takeOne('detect'),
    runAt: takeOne('run-at', 'runAt') ?? 'document_idle',
    allFrames: allFrames === undefined ? false : /^true$/i.test(allFrames),
    requires: take('require', 'requires'),
    connect: take('connect'),
    primary: takeOne('primary'),
    keywords: take('keyword', 'keywords'),
    homepage: takeOne('homepage', 'homepageURL'),
    author: takeOne('author'),
    actions,
    extra: {},
  };
  for (const [k, v] of Object.entries(raw)) {
    if (!used.has(k)) out.extra[k] = [...v];
  }
  return out;
}

function validateHeader(h) {
  if (!h.name) throw new Error('header missing @name');
  if (!h.namespace) throw new Error('header missing @namespace');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(h.name)) {
    throw new Error(`@name "${h.name}" must be lowercase kebab-case`);
  }
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(h.namespace)) {
    throw new Error(`@namespace "${h.namespace}" must be a valid JS identifier`);
  }
}

async function bundleBody({ body, entryHint, format, globalName }) {
  const opts = {
    stdin: {
      contents: body,
      resolveDir: path.dirname(entryHint),
      sourcefile: path.basename(entryHint).replace(/\.xgs\.js$/, '.entry.ts'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format,
    target: 'es2022',
    platform: 'browser',
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    plugins: [xgooseSkillAlias],
  };
  if (globalName) opts.globalName = globalName;
  const result = await build(opts);
  return result.outputFiles[0].text;
}

async function introspectBundle(esmBundle, header) {
  const wrapped =
    `globalThis.__XGOOSE_SKILL_META__ = ${JSON.stringify({
      name: header.name,
      namespace: header.namespace,
      primary: header.primary,
    })};\n` + esmBundle;
  const b64 = Buffer.from(wrapped, 'utf8').toString('base64');
  const url = `data:text/javascript;base64,${b64}`;
  let mod;
  try {
    mod = await import(url);
  } catch (err) {
    throw new Error(
      `failed to import bundled skill for introspection: ${err?.message ?? err}`,
    );
  }
  const def = mod?.default;
  if (!def || typeof def.__describe__ !== 'function') {
    throw new Error(
      'skill default export is not a defineSkill() bundle ' +
        '(missing __describe__ — did you forget `export default defineSkill({...})`?)',
    );
  }
  // `__describe__()` (the no-arg form) now returns input/output JSON
  // Schemas and authored examples per function as of the "schemas in
  // context" change. We ship all of that through to registry.json so
  // the per-turn system reminder can emit them inline and the agent
  // can shape its `js_exec` calls without a `help()` round trip.
  const summary = def.__describe__();
  const out = [];
  for (const [name, info] of Object.entries(summary ?? {})) {
    const entry = {
      name,
      summary: info.summary ?? '',
      signature: info.signature ?? '',
      invocation:
        info.invocation || `await xgoose.skills.${header.namespace}.${name}({...})`,
      input: info.input,
      primary: !!info.primary,
    };
    if (info.output !== undefined) entry.output = info.output;
    if (Array.isArray(info.examples) && info.examples.length) {
      entry.examples = info.examples;
    }
    out.push(entry);
  }
  if (header.primary && !out.some((f) => f.name === header.primary && f.primary)) {
    const hasFn = out.some((f) => f.name === header.primary);
    if (!hasFn) {
      throw new Error(
        `@primary "${header.primary}" does not match any exported function`,
      );
    }
    for (const f of out) f.primary = f.name === header.primary;
  }
  const bodyActions = Array.isArray(def.__meta__?.actions)
    ? def.__meta__.actions
    : [];
  const instructions =
    typeof def.__meta__?.instructions === 'string'
      ? def.__meta__.instructions
      : undefined;
  return { functions: out, bodyActions, instructions };
}

function wrapForBrowser({ header, iifeBody }) {
  const detectExpr =
    typeof header.detect === 'string' && header.detect.trim()
      ? header.detect.trim()
      : 'true';
  return [
    ';(function () {',
    `  try { if (!(${detectExpr})) return; } catch (_) { return; }`,
    `  globalThis.__XGOOSE_SKILL_META__ = ${JSON.stringify({
      name: header.name,
      namespace: header.namespace,
      primary: header.primary,
    })};`,
    `  ${iifeBody.replace(/\n/g, '\n  ')}`,
    '  var w = window;',
    '  w.xgoose = w.xgoose || { skills: {} };',
    '  w.xgoose.skills = w.xgoose.skills || {};',
    `  var __skill__ = (typeof __xgoose_skill_module__ !== 'undefined' && __xgoose_skill_module__ && __xgoose_skill_module__.default)`,
    `    ? __xgoose_skill_module__.default : null;`,
    `  if (__skill__ && typeof __skill__ === 'object') {`,
    `    w.xgoose.skills[${JSON.stringify(header.namespace)}] = __skill__;`,
    `  }`,
    '})();',
    '',
  ].join('\n');
}

export { parseSkillSource, buildHeaderObject, wrapForBrowser };
