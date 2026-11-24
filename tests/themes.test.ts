import { describe, expect, it } from "vitest";
import { THEME_IDS, THEMES, themesToCss } from "../src/lib/themes";

// WCAG contrast ratio between two hex colours (4.5 or more = readable body text).
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("themes", () => {
  it("outputs CSS variables for every theme", () => {
    const css = themesToCss();
    for (const id of THEME_IDS) expect(css).toContain(`[data-theme="${id}"]`);
    expect(css).toContain("--board-dark:");
    expect(css).toContain("--chart-1:");
  });

  it.each(THEME_IDS)("%s has readable text", (id) => {
    const t = THEMES[id].ui;
    for (const bg of [t.bg, t.surface, t.surfaceAlt]) {
      expect(contrast(t.text, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t.accentText, t.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
