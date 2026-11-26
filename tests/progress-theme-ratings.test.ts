import { describe, expect, it } from "vitest";
import { MIN_THEME_ATTEMPTS, themeRating, type ThemeAttempt } from "../src/lib/progress/theme-ratings";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 26, 12);
const puzzle = (labels: string[], solved: boolean, daysAgo = 1, rating = 1500): ThemeAttempt =>
  ({ labels, puzzleRating: rating, fullySolved: solved, at: NOW - daysAgo * DAY });
const own = (labels: string[], solved: boolean): ThemeAttempt => ({ labels, puzzleRating: null, fullySolved: solved, at: NOW - DAY });

describe("theme ratings", () => {
  it("rate a puzzle weakness from attempts carrying its labels only", () => {
    const forks = Array.from({ length: 12 }, () => puzzle(["fork", "middlegame"], true));
    const pins = Array.from({ length: 12 }, () => puzzle(["pin"], false));
    const r = themeRating("fork:missed", [...forks, ...pins], NOW)!;
    expect(r).toMatchObject({ kind: "rating", attempts: 12 });
    expect(r.kind === "rating" && r.rating).toBeGreaterThan(1500);
  });

  it("show only the count until there are enough attempts", () => {
    const few = Array.from({ length: MIN_THEME_ATTEMPTS - 1 }, () => puzzle(["fork"], true));
    expect(themeRating("fork:allowed", few, NOW)).toEqual({ kind: "few", attempts: MIN_THEME_ATTEMPTS - 1 });
    expect(themeRating("fork:allowed", [], NOW)).toEqual({ kind: "few", attempts: 0 }); // shown as "Puzzles 0/10"
  });

  it("need both labels for a pair", () => {
    const both = Array.from({ length: 10 }, () => puzzle(["fork", "rookEndgame"], true));
    const one = Array.from({ length: 10 }, () => puzzle(["fork"], false));
    expect(themeRating("fork:missed+rookEndgame", [...both, ...one], NOW)).toMatchObject({ kind: "rating", attempts: 10 });
  });

  it("show the change over the last 30 days once rated before then", () => {
    const old = Array.from({ length: 10 }, () => puzzle(["fork"], false, 60));
    const recent = Array.from({ length: 10 }, () => puzzle(["fork"], true, 5));
    const r = themeRating("fork:missed", [...old, ...recent], NOW)!;
    expect(r.kind === "rating" && r.change).toBeGreaterThan(0);
    expect(themeRating("fork:missed", recent, NOW)).toMatchObject({ change: null });
  });

  it("give the share solved for a weakness trained with own positions", () => {
    const a = [own(["pawnDecisions", "phaseTransition"], true), own(["pawnDecisions", "phaseTransition"], false), own(["pawnDecisions"], true)];
    expect(themeRating("pawnDecisions+phaseTransition", a, NOW)).toEqual({ kind: "own", attempts: 2, solved: 1 });
    expect(themeRating("converting+hangingPiece:missed", [], NOW)).toEqual({ kind: "own", attempts: 0, solved: 0 });
  });

  it("have nothing for openings", () => {
    expect(themeRating("opening:white:Italian Game", [puzzle(["fork"], true)], NOW)).toBeNull();
  });
});
