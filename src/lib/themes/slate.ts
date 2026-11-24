import type { Theme } from "./types";

// Default: blue and grey, for everyday use.
export const slate: Theme = {
  name: "Slate",
  colorScheme: "dark",
  ui: {
    bg: "#1b2430",
    surface: "#243040",
    surfaceAlt: "#2d3b4e",
    text: "#e8edf2",
    muted: "#9fb0c0",
    border: "#3a4b60",
    accent: "#6aa6de",
    accentText: "#0f1720",
    good: "#5cb88a",
    bad: "#e5867b",
  },
  board: { light: "#c9d4de", dark: "#6e8aa6" },
  chart: ["#6aa6de", "#e0a458", "#5cb88a", "#c17fd6", "#e5867b"],
};
