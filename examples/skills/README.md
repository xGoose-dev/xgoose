# Public skill example

`page-headings.xgs.js` is editable ESM source under the repository MIT license.
Paste it into Settings → skill editor, install it, and open https://example.com/.
Enable Chrome's **Allow User Scripts** setting when prompted. The agent can call
`xgoose.skills.pageHeadings.read({})` through `js_exec`.

Change the `@match` header only for sites where you want this skill available.
Disabling the skill removes its namespace and invalidates cached function
references; it cannot undo effects of calls that already completed.
