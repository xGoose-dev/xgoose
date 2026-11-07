# Appearance presets and analytics

The interface offers five complete presets: `default`, `glass`, `notebook`, `soft`, and `bold`.
The other controls are mode (`system`, `light`, `dark`), font (follow preset, sans, serif, mono),
and four text sizes (90%, 100%, 115%, 130%). There are no color, opacity, radius or shadow editors.
A preset selects the complete material, shape, typography, border and shadow treatment together.

| Preset | Material and geometry | Source |
| --- | --- | --- |
| Classic (`default`) | Existing platform appearance, unchanged | xgoose |
| Glass | 72% light / 78% dark fill, 24px backdrop blur, reflection layers, 20px corners | daisyUI Glass, adapted |
| Notebook | Opaque paper, fine rules, 10px corners, subtle offset shadow, bundled handwriting font | tweakcn Notebook, adapted |
| Soft | Opaque rounded surfaces, 24px corners, inset highlights and soft shadows | tweakcn Claymorphism, adapted |
| Bold | Opaque surface, square corners, 3px stroke, 4px hard offset shadow | tweakcn Neo Brutalism, adapted |

Existing Settings buttons retain their original options-page or native-app destination.
Appearance is an additional optional setting; an upgrade does not select a new preset.

## Storage and integration

`theme` remains the existing top-level mode field. `appearance` stores only
`{preset, font, fontScale}`. Missing/unsupported appearance fields normalize independently;
old settings retain their existing mode, provider and credentials. Appearance changes patch
only those two fields into the latest stored settings. Different devices/browsers keep their
own selections. Safari uses its existing same-device App Group bridge.

Web restores the saved appearance before first paint. The extension applies material styles
inside its own Shadow DOM and extension pages; it does not restyle the website being visited.
Fonts use local resources with CJK fallback. Code retains a monospace font. Glass becomes
opaque when reduced transparency is requested or backdrop filtering is unavailable.
SwiftUI uses native materials and dynamic text sizing, with equivalent preset shapes.

Preset source snapshots, license texts and original registry colors live in `theme-presets`.
The snapshots retain their source URLs and checksums. Tokens are converted to sRGB for the
existing HSL host interface. Original files are unmodified; shape/material adaptations are
in `appearance.ts` and `appearanceStyles.ts`. The Notebook font is Architects Daughter from
Google Fonts (SIL OFL); it is packaged locally in browser and native bundles.

Sources:
- https://tweakcn.com/r/themes/notebook.json
- https://tweakcn.com/r/themes/claymorphism.json
- https://tweakcn.com/r/themes/neo-brutalism.json
- https://github.com/saadeghi/daisyui/blob/master/packages/daisyui/src/utilities/glass.css
- https://github.com/google/fonts/tree/main/ofl/architectsdaughter

## Events

| Event | Trigger |
| --- | --- |
| `appearance_opened` | A settings visit begins; allocate its `flow_id` |
| `appearance_changed` | A distinct final selection is committed after the debounce |
| `appearance_saved` | Local persistence succeeds |
| `appearance_reset` | Restore-defaults succeeds; do not also emit changed/saved |
| `appearance_failed` | Persistence fails; restore the last saved preview and offer retry |
| `appearance_used` | The saved configuration is actually visible, once per context/session/configuration |

Dimensions: `preset`, `font`, `font_scale`, `theme`, `resolved_theme`, `is_customized`,
`entry_point`, plus existing platform, surface, session, flow and event identifiers.
Only preset identifiers are collected; there is no freeform theme code or font input.
All events retain the existing optional analytics/permission gates. Native events use
`surface=app`, extension events use `surface=extension`, and website events use `surface=website`.
The native durable queue preserves event IDs across retries and keeps collection outside
the settings file lock. Legacy color-only event fields remain readable in historical reports.

Admin appearance reporting reuses `/admin/analytics`. It returns an additional `appearance`
object with summary, preset/font/size/mode distributions, ordered visit conversion, resets,
and failures. Platform and surface filters apply to every query. Preference distribution uses
the last `appearance_used` row per actor/platform/surface in the selected period, with insertion
order breaking equal timestamp ties. Counts describe participating browser/install instances,
not distinct people. Existing general analytics and extension-activity summaries remain intact.

## Validation

Browser acceptance covers all five presets in light and dark modes, computed radius/stroke/
blur, screenshots, persistence, cross-tab updates, live panel updates, storage rollback/retry,
reset, opt-out and preservation of host-page styles. Unit tests cover normalization,
contrast, actual material differences, serial writes, native preset parity and upstream checksums.
Worker fixtures cover collection, dimension allowlists, latest-use aggregation, ordered visits,
filters, deduplication and app surfaces. Swift tests cover shared settings and durable opt-in queues.

No production release or store upload is part of this implementation. Website production
releases still require integration into current `origin/master` and the guarded release script.
