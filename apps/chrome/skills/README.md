# Bundled website skills

The website `.xgs.js` sources are the author's local `xgoose-skills` collection,
imported on 2026-10-23, including the local reader additions. They are tracked
here so a clean checkout and an offline build have the complete default skill
set; extension installation does not require an account, catalog request or
separate download to install them.

`npm run build` bundles every source and writes `dist/skills/registry.json`.
The registry enables built-in skills by default; users can disable them in
Settings. Previously disabled skills and local overrides are preserved.

When updating this collection, copy the reviewed source files from
`xgoose-skills`, then run the normal build and extension acceptance checks.
The source snapshot intentionally does not follow remote changes at runtime.

The Substack reader distinguishes the central Substack home/profile pages from
publication websites. Global publication search returns a compact `results`
list; pass a selected `publication` URL to archive, post, comment and feed
helpers. Cross-publication public reads use the Chrome host's bounded GET-only
publication relay, following the Substack host's custom-domain redirect without
cookies. This requires updating the complete Chrome build, including its
background/content/page bridge, rather than replacing only the skill file.
Same-origin publication reads continue to use the current browser session.

Catalog update identities are pinned in `src/shared/builtinCatalog.json` from the official catalog snapshot on 2026-10-24. Only matching skill IDs and author IDs may update bundled skills. Skills not published in the catalog receive updates with the extension or through manual import.

The bundled `xgoose-guide` help skill is active only on xgoose.org and www.xgoose.org. It explains website context, setup, installation and authoring. The extension-served onboarding page presents the same entry points natively, before User Scripts is enabled. Other websites retain only their matching website skills.
