# Chrome Web Store assets

The editable icon master is `branding/icon.svg`. Run `node scripts/render-brand.mjs` to render extension toolbar sizes and the 512px store source.

The selected screenshots show actual extension UI: an existing uscardforum research session and the current settings pages. Email capture is signed out, without an address entered. Skills capture contains installed public forum skills. No API keys, login tokens, private browser profiles or full transcript evidence belong in this directory.

`research.png`, `skills.png`, and `email.png` are full 1280×800 captures. The settings `*-raw.png` files are 1280×640 captures for the store layouts. `node scripts/render-store-assets.mjs` composes the 1280×800 store images, 440×280 small tile, 1400×560 marquee, and 1200×630 social image. The artwork adds explanatory headings without fabricating or rewriting the product interface or model output.

The 0.2.1 package changes the icon, short description, and settings guidance. PI, Hosted routing, permissions and privacy behavior are unchanged from 0.2.0. Submission and publication are separate states; check the developer dashboard for the current review status.
