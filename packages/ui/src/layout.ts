// Layout state for the floating panel — where the toggle button sits and
// how big the panel is. Plain TS types (no zod) so the UI package stays
// peer-dep-free; hosts that persist layout to storage can layer their own
// Zod schema on top, structurally compatible with these types.

export type Corner = "br" | "bl" | "tr" | "tl";

export type Layout = {
  /** Which corner the floating toggle button is docked to. */
  buttonCorner: Corner;
  /** Pixel offset from the docked corner. */
  buttonOffset: { h: number; v: number };
  /** Which corner the open panel attaches to (usually mirrors button). */
  panelCorner: Corner;
  /** Panel size in CSS pixels. Ignored on mobile / overlay mode. */
  panelSize: { w: number; h: number };
};

export const DEFAULT_LAYOUT: Layout = {
  buttonCorner: "br",
  buttonOffset: { h: 20, v: 20 },
  panelCorner: "br",
  panelSize: { w: 460, h: 640 },
};
