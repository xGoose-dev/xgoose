#!/usr/bin/env node
// Copy the canonical `SKILL_AUTHORING.md` (kept in this package) into the
// three host repos that ship it to authors:
//
//   - xgoose-extension-chrome/skills/SKILL_AUTHORING.md
//   - xgoose-extension-safari/skills/SKILL_AUTHORING.md
//   - xgoose-web/web/app/docs/skills/SKILL_AUTHORING.md   (rendered at /docs/skills/)
//
// Run from any of those repos with:
//   node ../xgoose-core/packages/skill-runtime/scripts/sync-authoring-doc.mjs
//
// Idempotent. Logs each destination + whether it was already in sync.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '..', 'SKILL_AUTHORING.md');
// All destinations are resolved relative to the xgoose-core repo root
// (../../../ from this file). The four repos live as siblings under ~/xgoose.
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const DESTINATIONS = [
  path.join(ROOT, 'xgoose-extension-chrome', 'skills', 'SKILL_AUTHORING.md'),
  path.join(ROOT, 'xgoose-extension-safari', 'skills', 'SKILL_AUTHORING.md'),
  path.join(ROOT, 'xgoose-web', 'web', 'app', 'docs', 'skills', 'SKILL_AUTHORING.md'),
];

const source = fs.readFileSync(SOURCE, 'utf8');
console.log(`[sync-authoring-doc] source: ${SOURCE} (${source.length} bytes)`);
let changed = 0;
for (const dest of DESTINATIONS) {
  if (!fs.existsSync(path.dirname(dest))) {
    console.log(`[sync-authoring-doc] skip (missing dir): ${dest}`);
    continue;
  }
  const prev = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
  if (prev === source) {
    console.log(`[sync-authoring-doc] in sync: ${dest}`);
    continue;
  }
  fs.writeFileSync(dest, source);
  console.log(`[sync-authoring-doc] wrote:   ${dest}`);
  changed += 1;
}
console.log(`[sync-authoring-doc] ${changed} of ${DESTINATIONS.length} files updated.`);
