import type { Theme } from "./types";

// Light, warm neutrals for daytime.
export const paper: Theme = {
  name: "Paper",
  colorScheme: "light",
  ui: {
    bg: "#f7f3ec",
    surface: "#fffdf8",
    surfaceAlt: "#efe8dc",
    text: "#2b2620",
    muted: "#6a6055",
    border: "#d9cebd",
    accent: "#8f5229",
    accentText: "#fffdf8",
    good: "#2f6e42",
    bad: "#b03c2b",
  },
  board: { light: "#f0dfc0", dark: "#b58863" },
  chart: ["#8f5229", "#3f6e9a", "#2f6e42", "#8a4f8f", "#b03c2b"],
};
