# Chromium store delivery

Version bumps merged into main run the release gates and publish immutable Chrome and Edge ZIPs with SHA256SUMS. Both ZIPs use the same tested package; browser-specific links and wording are selected at runtime. A new GitHub release dispatches `store-publish.yml` explicitly because events created with GITHUB_TOKEN do not normally start another workflow. Manual dispatch takes an existing `vX.Y.Z` release and a destination.

The submit workflow downloads existing release assets, verifies their SHA256SUMS, then uses Chrome Web Store API v2 or Edge Publish API v1.1. It never builds a different package, moves a tag, changes listing metadata, withdraws a review, or bypasses a store limit. Failed uploads and pending-review conflicts require dashboard inspection before a manual retry. Store submission is distinct from store approval/public availability.

Configure these GitHub repository secrets after authorizing dedicated store-publishing access:

- Chrome (dedicated service account): CWS_SERVICE_ACCOUNT_JSON, CWS_PUBLISHER_ID, CWS_EXTENSION_ID. The account is linked in the publisher dashboard and has no Google Cloud project roles. Legacy OAuth is also supported with CWS_CLIENT_ID, CWS_CLIENT_SECRET and CWS_REFRESH_TOKEN instead of CWS_SERVICE_ACCOUNT_JSON.
- Edge: EDGE_CLIENT_ID, EDGE_API_KEY, EDGE_PRODUCT_ID.

Missing secrets leave a clear 'not submitted' workflow summary. Use the authenticated internal browser for that release. Do not extract browser session cookies for CI or put personal API keys into public artifacts.

Official API references:

- https://developer.chrome.com/docs/webstore/using-api
- https://developer.chrome.com/docs/webstore/api/reference/rest/v2/UploadState
- https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/addons-api-reference

Mozilla uses the separate xGoose-dev/firefox repository, whose store workflow runs `web-ext sign --channel listed` with an archived review source ZIP. Required repository secrets are AMO_JWT_ISSUER and AMO_JWT_SECRET. Firefox-specific permissions, privacy defaults and background architecture must be preserved when sharing core changes.
