// chess.com public API (free, no key): https://www.chess.com/news/view/published-data-api
// Turns chess.com's game format into rows for the `games` table.

const API = "https://api.chess.com/pub";
// chess.com asks API clients to identify themselves. Kept generic: no personal details.
const USER_AGENT = "Blindspot chess trainer (personal, non-commercial project)";

export interface ChessComPlayer {
  username: string;
  rating?: number;
  result: string; // "win", "checkmated", "resigned", "timeout", "agreed", ...
}

export interface ChessComGame {
  url: string;
  uuid?: string;
  pgn?: string;
  time_control: string;
  time_class: string;
  end_time: number; // unix seconds
  rated: boolean;
  rules: string; // "chess" for standard games; variants are skipped
  eco?: string; // link to the opening page on chess.com
  white: ChessComPlayer;
  black: ChessComPlayer;
}

export interface GameRow {
  user_id: string;
  source: "chesscom";
  source_game_id: string;
  url: string;
  played_at: string;
  time_class: string;
  time_control: string;
  rated: boolean;
  colour: "white" | "black";
  user_rating: number | null;
  opponent_rating: number | null;
  result: "win" | "loss" | "draw";
  result_detail: string;
  eco: string | null;
  opening_name: string | null;
  pgn: string;
  clocks: number[];
}

const DRAW_RESULTS = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);

/** chess.com result codes -> win / loss / draw, from the user's side. */
export function outcome(userResult: string): "win" | "loss" | "draw" {
  if (userResult === "win") return "win";
  if (DRAW_RESULTS.has(userResult)) return "draw";
  return "loss";
}

/** Reads one PGN header, e.g. header(pgn, "ECO") -> "B90". */
export function pgnHeader(pgn: string, name: string): string | null {
  const match = pgn.match(new RegExp(`^\\[${name} "([^"]*)"\\]`, "m"));
  return match ? match[1] : null;
}

/**
 * Clock after every move, in tenths of a second, from {[%clk 0:04:58.3]} comments.
 * Format is hours:minutes:seconds; daily games just use large hour counts (e.g. 71:59:59).
 */
export function parseClocks(pgn: string): number[] {
  const out: number[] = [];
  for (const m of pgn.matchAll(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g)) {
    const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    out.push(Math.round(seconds * 10));
  }
  return out;
}

/** "https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation-6.Be3" -> "Sicilian Defense Najdorf Variation 6.Be3" */
export function openingNameFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const slug = url.split("/openings/")[1];
  if (!slug) return null;
  return decodeURIComponent(slug).replace(/-/g, " ").trim() || null;
}

/** The game's id: the last part of its URL, e.g. ".../game/live/123456789" -> "live/123456789". */
export function gameId(game: ChessComGame): string {
  const m = game.url.match(/\/game\/(.+)$/);
  return m ? m[1] : (game.uuid ?? game.url);
}

/** One chess.com game -> one `games` row, or null if it should be skipped (variants, no PGN, not the user's game). */
export function toGameRow(game: ChessComGame, username: string, userId: string): GameRow | null {
  if (game.rules !== "chess" || !game.pgn) return null;
  const me = username.toLowerCase();
  const colour = game.white.username.toLowerCase() === me ? "white"
    : game.black.username.toLowerCase() === me ? "black"
    : null;
  if (!colour) return null;
  const mine = colour === "white" ? game.white : game.black;
  const theirs = colour === "white" ? game.black : game.white;

  return {
    user_id: userId,
    source: "chesscom",
    source_game_id: gameId(game),
    url: game.url,
    played_at: new Date(game.end_time * 1000).toISOString(),
    time_class: game.time_class,
    time_control: game.time_control,
    rated: game.rated,
    colour,
    user_rating: mine.rating ?? null,
    opponent_rating: theirs.rating ?? null,
    result: outcome(mine.result),
    result_detail: mine.result === "win" ? theirs.result : mine.result,
    eco: pgnHeader(game.pgn, "ECO"),
    opening_name: openingNameFromUrl(game.eco ?? pgnHeader(game.pgn, "ECOUrl")),
    pgn: game.pgn,
    clocks: parseClocks(game.pgn),
  };
}

// ---------------------------------------------------------------------------
// Which monthly archives to fetch
// ---------------------------------------------------------------------------

export interface ArchivePlan {
  url: string;
  /** true for months that have ended: they never change, so they're fetched once. */
  complete: boolean;
}

/**
 * Picks the archive URLs inside the history window.
 * @param months how many months back (12 = this month plus the 11 before it); null = everything.
 */
export function planArchives(archiveUrls: string[], months: number | null, now: Date): ArchivePlan[] {
  const thisMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const out: ArchivePlan[] = [];
  for (const url of archiveUrls) {
    const m = url.match(/\/(\d{4})\/(\d{2})$/);
    if (!m) continue;
    const month = Number(m[1]) * 12 + (Number(m[2]) - 1);
    if (months !== null && month <= thisMonth - months) continue;
    out.push({ url, complete: month < thisMonth });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Network calls
// ---------------------------------------------------------------------------

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (res.ok) return (await res.json()) as T;
    // 429 = "too many requests": wait and try again, as chess.com asks.
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    // The URL contains the username, so it's left out of the message (logs can be public).
    throw new Error(`chess.com returned ${res.status}${res.status === 404 ? " (username not found?)" : ""}`);
  }
}

const player = (username: string) => `${API}/player/${encodeURIComponent(username.toLowerCase())}`;

export async function fetchArchiveList(username: string): Promise<string[]> {
  const data = await getJson<{ archives: string[] }>(`${player(username)}/games/archives`);
  return data.archives ?? [];
}

export async function fetchArchive(url: string): Promise<ChessComGame[]> {
  const data = await getJson<{ games: ChessComGame[] }>(url);
  return data.games ?? [];
}

/** Current ratings per time class, e.g. { blitz: 1200, daily: 1800 }. */
export async function fetchRatings(username: string): Promise<Record<string, number>> {
  const stats = await getJson<Record<string, { last?: { rating?: number } }>>(`${player(username)}/stats`);
  const out: Record<string, number> = {};
  for (const timeClass of ["bullet", "blitz", "rapid", "daily"]) {
    const rating = stats[`chess_${timeClass}`]?.last?.rating;
    if (typeof rating === "number") out[timeClass] = rating;
  }
  return out;
}
