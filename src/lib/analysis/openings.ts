// Opening labels (SPEC.md -> "Openings by colour").
//
// White: a narrow repertoire, so scored down to the variation (from chess.com's opening name).
// Black: grouped by the user's own reply to White's first move (e.g. "your reply to 1.e4: 1...c5"),
//        not by the opponent's opening, to pool small samples.
// Rare openings roll up: variation -> family -> one "Offbeat openings" bucket.

/** An opening needs at least this many games (in one profile) to be scored on its own. */
export const OFFBEAT_MIN_GAMES = 5;

export const OFFBEAT = "opening:offbeat";

export interface GameOpening {
  /** Broad group: White's opening family, or White's first move when the user is Black. */
  family: string;
  /** Narrow group: White's variation, or White's first move + the user's reply when Black. */
  variation: string;
}

const FAMILY_ENDINGS = new Set(["Opening", "Game", "Defense", "Defence", "Attack", "Gambit", "System"]);

/** "Sicilian Defense Najdorf Variation 6.Be3 e5" -> "Sicilian Defense Najdorf Variation" (drops the trailing moves). */
export function variationName(openingName: string): string {
  const words = openingName.trim().split(/\s+/);
  const cut = words.findIndex((w) => /^\d+\./.test(w));
  return (cut === -1 ? words : words.slice(0, cut)).join(" ") || openingName.trim();
}

/** "Sicilian Defense Najdorf Variation" -> "Sicilian Defense". */
export function familyName(variation: string): string {
  const words = variation.split(" ");
  const end = words.findIndex((w) => FAMILY_ENDINGS.has(w));
  return end === -1 ? variation : words.slice(0, end + 1).join(" ");
}

/** The opening of one game. `firstMoves` = the game's first two moves in SAN. */
export function gameOpening(colour: "white" | "black", openingName: string | null, firstMoves: string[]): GameOpening {
  if (colour === "white") {
    const variation = openingName ? variationName(openingName) : "Unknown opening";
    return { family: familyName(variation), variation };
  }
  const [whiteMove = "?", reply = "?"] = firstMoves;
  return { family: whiteMove, variation: `${whiteMove} ${reply}` };
}

/** Label keys for the three levels. */
export const openingKey = {
  whiteVariation: (v: string) => `opening:w:${v}`,
  whiteFamily: (f: string) => `opening:wf:${f}`,
  blackReply: (v: string) => `opening:b:${v}`,
  blackFirstMove: (f: string) => `opening:bf:${f}`,
};

/**
 * Decides each game's opening label, rolling rare ones up.
 * @returns game id -> label key
 */
export function assignOpenings(games: { id: number; colour: "white" | "black"; opening: GameOpening }[]): Map<number, string> {
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const narrow = (g: (typeof games)[number]) =>
    g.colour === "white" ? openingKey.whiteVariation(g.opening.variation) : openingKey.blackReply(g.opening.variation);
  const broad = (g: (typeof games)[number]) =>
    g.colour === "white" ? openingKey.whiteFamily(g.opening.family) : openingKey.blackFirstMove(g.opening.family);

  const narrowCounts = count(games.map(narrow));
  const broadCounts = count(games.filter((g) => narrowCounts.get(narrow(g))! < OFFBEAT_MIN_GAMES).map(broad));

  const out = new Map<number, string>();
  for (const g of games) {
    if (narrowCounts.get(narrow(g))! >= OFFBEAT_MIN_GAMES) out.set(g.id, narrow(g));
    else if ((broadCounts.get(broad(g)) ?? 0) >= OFFBEAT_MIN_GAMES) out.set(g.id, broad(g));
    else out.set(g.id, OFFBEAT);
  }
  return out;
}

/** Display name of an opening label. */
export function describeOpening(key: string): string {
  if (key === OFFBEAT) return "Offbeat openings";
  const [, level, ...rest] = key.split(":");
  const value = rest.join(":");
  switch (level) {
    case "w": return `${value} (as White)`;
    case "wf": return `${value}, other lines (as White)`;
    case "b": {
      const [first, reply] = value.split(" ");
      return `Your reply to 1.${first}: 1...${reply}`;
    }
    case "bf": return `Your other replies to 1.${value}`;
    default: return key;
  }
}
