import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, describeTimeControl, parseSettingsForm, settingsFromRow, settingsToRow } from "../src/lib/settings";

function form(overrides: Record<string, string | null> = {}): FormData {
  const values: Record<string, string | null> = {
    chesscomUsername: "Test_Player",
    focusTimeControl: "300",
    historyMonths: "12",
    weaknessesShown: "5",
    gamesWeightPct: "70",
    halfLifeDays: "60",
    targetTime: "normal",
    survivalLives: "3",
    engineOnBoard: null,
    theme: "slate",
    ...overrides,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) if (v !== null) fd.set(k, v);
  return fd;
}

describe("parseSettingsForm", () => {
  it("accepts the defaults", () => {
    expect(parseSettingsForm(form())).toEqual({ ...DEFAULT_SETTINGS, chesscomUsername: "Test_Player" });
  });

  it("handles 'all games', checkboxes and an empty username", () => {
    const s = parseSettingsForm(form({ historyMonths: "all", engineOnBoard: "on", chesscomUsername: "  " }));
    expect(s.historyMonths).toBeNull();
    expect(s.engineOnBoard).toBe(true);
    expect(s.chesscomUsername).toBeNull();
  });

  it.each([
    ["weaknessesShown", "9"],
    ["gamesWeightPct", "101"],
    ["halfLifeDays", "7"],
    ["survivalLives", "0"],
    ["theme", "neon"],
    ["chesscomUsername", "bad name!"],
    ["focusTimeControl", "abc"],
  ])("rejects %s = %s", (field, value) => {
    expect(() => parseSettingsForm(form({ [field]: value }))).toThrow();
  });
});

describe("settings rows", () => {
  it("round-trips through the database format", () => {
    expect(settingsFromRow(settingsToRow(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });
});

describe("describeTimeControl", () => {
  it.each([
    ["300", "5 min"],
    ["180+2", "3+2"],
    ["600", "10 min"],
    ["1/86400", "Daily (1 day)"],
    ["1/259200", "Daily (3 days)"],
  ])("%s -> %s", (tc, text) => {
    expect(describeTimeControl(tc)).toBe(text);
  });
});
