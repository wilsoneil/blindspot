// Every adjustable choice in one place (SPEC.md -> "Settings").
// The database columns and their defaults mirror this file (supabase/migrations/0001_init.sql).

import { THEME_IDS, type ThemeId } from "./themes";

export type TargetTime = "stricter" | "normal" | "looser";

export interface Settings {
  chesscomUsername: string | null;
  focusTimeControl: string; // chess.com time_control, e.g. "300" = 5-minute blitz
  weaknessesShown: number;
  gamesWeightPct: number;
  halfLifeDays: number;
  historyMonths: number | null; // null = all games
  targetTime: TargetTime;
  survivalLives: number;
  engineOnBoard: boolean;
  theme: ThemeId;
  aiEnabled: boolean;
  aiMonthlyBudgetGbp: number;
  aiDailyLimit: number;
}

export const DEFAULT_SETTINGS: Settings = {
  chesscomUsername: null,
  focusTimeControl: "300",
  weaknessesShown: 5,
  gamesWeightPct: 70,
  halfLifeDays: 60,
  historyMonths: 12,
  targetTime: "normal",
  survivalLives: 3,
  engineOnBoard: false,
  theme: "slate",
  aiEnabled: true,
  aiMonthlyBudgetGbp: 5,
  aiDailyLimit: 20,
};

export const HISTORY_OPTIONS: { value: number | null; label: string }[] = [
  { value: 3, label: "Last 3 months" },
  { value: 6, label: "Last 6 months" },
  { value: 12, label: "Last 12 months" },
  { value: 24, label: "Last 2 years" },
  { value: null, label: "All games" },
];

/** Turns a chess.com time_control string into words: "300" -> "5 min", "180+2" -> "3+2", "1/86400" -> "Daily (1 day)". */
export function describeTimeControl(tc: string): string {
  if (tc.includes("/")) {
    const seconds = Number(tc.split("/")[1]);
    const days = Math.round(seconds / 86400);
    return `Daily (${days} day${days === 1 ? "" : "s"})`;
  }
  const [base, inc] = tc.split("+").map(Number);
  const mins = base / 60;
  const minsText = Number.isInteger(mins) ? String(mins) : mins.toFixed(1);
  return inc ? `${minsText}+${inc}` : `${minsText} min`;
}

// ---------------------------------------------------------------------------
// Validation of the settings form
// ---------------------------------------------------------------------------

const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/; // chess.com usernames: letters, digits, _ and -
const TIME_CONTROL_RE = /^(\d+(\+\d+)?|1\/\d+)$/;

function int(value: FormDataEntryValue | null, min: number, max: number, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new SettingsError(`${field} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

export class SettingsError extends Error {}

/** Reads and checks the settings form. Throws SettingsError with a plain-English message. */
export function parseSettingsForm(form: FormData): Settings {
  const username = String(form.get("chesscomUsername") ?? "").trim();
  if (username && !USERNAME_RE.test(username)) {
    throw new SettingsError("That doesn't look like a chess.com username.");
  }

  const focusTimeControl = String(form.get("focusTimeControl") ?? "");
  if (!TIME_CONTROL_RE.test(focusTimeControl)) throw new SettingsError("Unknown time control.");

  const historyRaw = String(form.get("historyMonths") ?? "");
  const historyMonths = historyRaw === "all" ? null : int(historyRaw, 3, 600, "History window");

  const targetTime = String(form.get("targetTime"));
  if (!["stricter", "normal", "looser"].includes(targetTime)) throw new SettingsError("Unknown target time.");

  const theme = String(form.get("theme"));
  if (!(THEME_IDS as readonly string[]).includes(theme)) throw new SettingsError("Unknown theme.");

  const budget = Number(form.get("aiMonthlyBudgetGbp"));
  if (!Number.isFinite(budget) || budget < 0 || budget > 1000) {
    throw new SettingsError("AI monthly budget must be between £0 and £1,000.");
  }

  return {
    chesscomUsername: username || null,
    focusTimeControl,
    weaknessesShown: int(form.get("weaknessesShown"), 3, 8, "Number of weaknesses"),
    gamesWeightPct: int(form.get("gamesWeightPct"), 0, 100, "Games vs puzzles blend"),
    halfLifeDays: int(form.get("halfLifeDays"), 14, 365, "Recency half-life"),
    historyMonths,
    targetTime: targetTime as TargetTime,
    survivalLives: int(form.get("survivalLives"), 1, 5, "Survival lives"),
    engineOnBoard: form.get("engineOnBoard") === "on",
    theme: theme as ThemeId,
    aiEnabled: form.get("aiEnabled") === "on",
    aiMonthlyBudgetGbp: Math.round(budget * 100) / 100,
    aiDailyLimit: int(form.get("aiDailyLimit"), 0, 1000, "AI daily limit"),
  };
}

// ---------------------------------------------------------------------------
// Database row <-> Settings
// ---------------------------------------------------------------------------

export interface SettingsRow {
  chesscom_username: string | null;
  focus_time_control: string;
  weaknesses_shown: number;
  games_weight_pct: number;
  half_life_days: number;
  history_months: number | null;
  target_time: string;
  // rush_minutes (0001) is no longer used: Rush is always 5 minutes (RUSH_MINUTES, src/app/train/mixed-page.tsx).
  survival_lives: number;
  engine_on_board: boolean;
  theme: string;
  ai_enabled: boolean;
  ai_monthly_budget_gbp: number | string; // Postgres numeric arrives as a string
  ai_daily_limit: number;
}

export function settingsFromRow(row: SettingsRow): Settings {
  return {
    chesscomUsername: row.chesscom_username,
    focusTimeControl: row.focus_time_control,
    weaknessesShown: row.weaknesses_shown,
    gamesWeightPct: row.games_weight_pct,
    halfLifeDays: row.half_life_days,
    historyMonths: row.history_months,
    targetTime: row.target_time as TargetTime,
    survivalLives: row.survival_lives,
    engineOnBoard: row.engine_on_board,
    theme: (THEME_IDS as readonly string[]).includes(row.theme) ? (row.theme as ThemeId) : DEFAULT_SETTINGS.theme,
    aiEnabled: row.ai_enabled,
    aiMonthlyBudgetGbp: Number(row.ai_monthly_budget_gbp),
    aiDailyLimit: row.ai_daily_limit,
  };
}

export function settingsToRow(s: Settings): SettingsRow {
  return {
    chesscom_username: s.chesscomUsername,
    focus_time_control: s.focusTimeControl,
    weaknesses_shown: s.weaknessesShown,
    games_weight_pct: s.gamesWeightPct,
    half_life_days: s.halfLifeDays,
    history_months: s.historyMonths,
    target_time: s.targetTime,
    survival_lives: s.survivalLives,
    engine_on_board: s.engineOnBoard,
    theme: s.theme,
    ai_enabled: s.aiEnabled,
    ai_monthly_budget_gbp: s.aiMonthlyBudgetGbp,
    ai_daily_limit: s.aiDailyLimit,
  };
}
