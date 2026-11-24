import type { Theme } from "./types";

// Dark green and near-black: the classic club-board feel.
export const tournament: Theme = {
  name: "Tournament",
  colorScheme: "dark",
  ui: {
    bg: "#0f1411",
    surface: "#17201a",
    surfaceAlt: "#1f2b23",
    text: "#e6ece7",
    muted: "#97a99c",
    border: "#2f3f34",
    accent: "#5cbf86",
    accentText: "#08110b",
    good: "#5cbf86",
    bad: "#e5806e",
  },
  board: { light: "#e9edcc", dark: "#779954" },
  chart: ["#5cbf86", "#d9b45a", "#6fa8dc", "#c98bd1", "#e5806e"],
};
