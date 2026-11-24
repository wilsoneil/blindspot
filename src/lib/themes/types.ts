// The shape every theme file fills in. Board, UI and chart colours are set together.
export interface Theme {
  name: string;
  colorScheme: "light" | "dark"; // tells the browser which way form controls and scrollbars should look
  ui: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentText: string; // text on top of the accent colour
    good: string;
    bad: string;
  };
  board: { light: string; dark: string };
  chart: string[]; // series colours, in order
}
