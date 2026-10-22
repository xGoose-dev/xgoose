// MAIN-world entry — esbuild bundles this into `dist/pageBridge.js`,
// which Chrome's manifest loads via the second `content_scripts` entry
// with `"world": "MAIN"` at `document_start`. The actual bridge runtime
// (window.__xgoose + the request/response CustomEvent listeners) lives
// in `@xgoose/page-controller/pageBridge`.
import "@xgoose/page-controller/pageBridge";
