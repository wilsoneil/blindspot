// The theme registry. To add a theme: create a file like slate.ts, then add it here.
import { paper } from "./paper";
import { slate } from "./slate";
import { tournament } from "./tournament";
import type { Theme } from "./types";

export const THEMES = { slate, tournament, paper } satisfies Record<string, Theme>;
export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export type { Theme };

/** Turns every theme into CSS variables, e.g. [data-theme="slate"] { --bg: #1b2430; ... } */
export function themesToCss(): string {
  return THEME_IDS.map((id) => {
    const t: Theme = THEMES[id];
    const vars: Record<string, string> = {
      "color-scheme": t.colorScheme,
      "--bg": t.ui.bg,
      "--surface": t.ui.surface,
      "--surface-alt": t.ui.surfaceAlt,
      "--text": t.ui.text,
      "--muted": t.ui.muted,
      "--border": t.ui.border,
      "--accent": t.ui.accent,
      "--accent-text": t.ui.accentText,
      "--good": t.ui.good,
      "--bad": t.ui.bad,
      "--board-light": t.board.light,
      "--board-dark": t.board.dark,
      ...Object.fromEntries(t.chart.map((c, i) => [`--chart-${i + 1}`, c])),
    };
    const body = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
    return `[data-theme="${id}"]{${body}}`;
  }).join("\n");
}
