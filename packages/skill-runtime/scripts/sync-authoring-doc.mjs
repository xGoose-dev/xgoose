#!/usr/bin/env node
// Copy the canonical `SKILL_AUTHORING.md` (kept in this package) to the Chrome
// skills directory, which the build ships for `skill_help`:
//
//   node packages/skill-runtime/scripts/sync-authoring-doc.mjs
//
// The website copy (xgoose-web: web/app/docs/skills/SKILL_AUTHORING.md) lives in
// another repository and is updated through its own release.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '..', 'SKILL_AUTHORING.md');
const ROOT = path.resolve(__dirname, '..', '..', '..');

const DESTINATIONS = [path.join(ROOT, 'apps', 'chrome', 'skills', 'SKILL_AUTHORING.md')];

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
