# Chrome CI and releases

`main` is the default integration and release branch. Keep feature work on
`codex/*` branches and open pull requests against `main`.

## CI

Open **Actions → Chrome CI → Run workflow** and select **main** to run checks and package the extension. Tests use disposable browser profiles and fixture providers.

Tested ZIP, SHA256SUMS and release-manifest.json are retained in Actions for
14 days. The manifest records the exact commit, version, built-in skill count
and ZIP hash. Source maps are excluded. Failed runs retain browser diagnostics
where available for 7 days.

## Publish a version

1. Run `node scripts/set-version.mjs 0.2.9` with the desired version. This updates
   root/app packages, the Chrome manifest and corresponding lockfile versions.
   Shared package versions are unchanged.
2. Merge the version and product changes into `main`.
3. Open **Actions → Chrome Release → Run workflow** and select **main**.
   Keep **dry_run** checked to verify and package the release. Uncheck it to
   create the version tag and GitHub Release after validation.

The built-in GITHUB_TOKEN is sufficient; no personal token or AI-provider key
is required. Only the publish job has repository contents write access. Tags
created with this token do not trigger a second workflow, so tag creation and
asset publication happen in the same job. Actions are pinned to commit hashes.

Existing versions are never replaced. Re-running a completed release checks
its tag and compares existing assets; different files under an existing version
fail instead of being overwritten.

## Chrome Web Store

A newly published GitHub Release dispatches the store submission workflow.
To submit an existing tested release, open **Actions → Submit Chrome and Edge stores → Run workflow**
on **main** and enter its `vX.Y.Z` tag.
