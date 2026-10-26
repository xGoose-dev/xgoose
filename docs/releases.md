# Chrome CI and automatic GitHub releases

`main` is the default integration and release branch. Keep feature work on
`codex/*` branches and open pull requests against `main`.

## CI

Every branch push and pull request runs **Chrome CI**: locked dependencies,
typecheck, unit tests, production build, browser suites in `npm run e2e`,
and package validation. Tests use disposable Chromium profiles and fixture
providers. Paid live-provider tests are not run in CI.

Tested ZIP, SHA256SUMS and release-manifest.json are retained in Actions for
14 days. The manifest records the exact commit, version, built-in skill count
and ZIP hash. Source maps are excluded. Failed runs retain browser diagnostics
where available for 7 days.

## Publish a version

1. Run `node scripts/set-version.mjs 0.2.9` with the desired version. This updates
   root/app packages, the Chrome manifest and corresponding lockfile versions.
   Shared package versions are unchanged.
2. Commit the version and product changes, open a PR against `main`, and merge
   after CI passes.
3. **Chrome Release** detects the version increase, reruns full CI, downloads
   its tested artifact, verifies its checksum, and creates `v0.2.9` and a GitHub
   Release containing ZIP, checksums and build manifest.

The built-in GITHUB_TOKEN is sufficient; no personal token or AI-provider key
is required. Only the publish job has repository contents write access. Tags
created with this token do not trigger a second workflow, so tag creation and
asset publication happen in the same job. Actions are pinned to commit hashes.

Existing versions are never replaced. Re-running a completed release checks
its tag and compares existing assets; different files under an existing version
fail instead of being overwritten. A version update must increase the version.

## Manual verification or release

Open **Actions → Chrome Release → Run workflow**, select **main**, and leave
**dry_run** checked. This runs validation, browser tests, packaging and checksum
verification without creating a tag or release. To deliberately release the
current version, uncheck **dry_run**. A manually pushed `vX.Y.Z` tag can also
release an already-merged commit: its name must match all source versions and
the commit must be on `main`.

## Chrome Web Store

A GitHub Release supplies the store-ready ZIP. It does not update the Chrome
Web Store or bypass Google's review. No Chrome Web Store API publishing
credentials are configured in this repository, so automated store submission
is not enabled. Upload the release ZIP through the existing Developer Dashboard
until API credentials are configured through Actions secrets.

Uncommitted 0.2.8 work in another local checkout is not imported by this
infrastructure change. Commit and merge the intended release sources before
increasing the version or publishing that version manually.
