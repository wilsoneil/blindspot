// The fixed list of weakness labels (SPEC.md -> "Categories").
//
// Every label maps to Lichess puzzle themes (so Lichess puzzles can train it), or is
// computed by Blindspot itself and trained with "find the move" positions from the
// user's own games (Phase 3), or both.
//
// Adding a label later = adding one entry here.

export type LabelFamily =
  | "tactic"
  | "mate"
  | "phase"
  | "endgame"
  | "opening"
  | "moveType"
  | "positionState";

export interface Label {
  id: string;
  name: string;
  family: LabelFamily;
  /** Lichess puzzle themes that train this label (any one matches). Empty = positional. */
  lichessThemes: string[];
  /** Tactics and mates are tracked separately as "missed" and "allowed". */
  missedAllowed?: boolean;
  /** Computed from the user's games and trained with "find the move" positions from them. */
  fromOwnGames?: boolean;
}

const tactic = (id: string, name: string, themes: string[]): Label => ({
  id, name, family: "tactic", lichessThemes: themes, missedAllowed: true,
});
const mate = (id: string, name: string, themes: string[]): Label => ({
  id, name, family: "mate", lichessThemes: themes, missedAllowed: true,
});

export const LABELS: Label[] = [
  // Tactical motifs
  tactic("fork", "Fork", ["fork"]),
  tactic("pin", "Pin", ["pin"]),
  tactic("skewer", "Skewer", ["skewer"]),
  tactic("discoveredAttack", "Discovered attack", ["discoveredAttack"]),
  tactic("discoveredOrDoubleCheck", "Discovered or double check", ["discoveredCheck", "doubleCheck"]),
  tactic("hangingPiece", "Hanging piece", ["hangingPiece"]),
  tactic("trappedPiece", "Trapped piece", ["trappedPiece"]),
  tactic("captureDefender", "Capture the defender", ["capturingDefender"]),
  tactic("deflection", "Deflection", ["deflection"]),
  tactic("attraction", "Attraction", ["attraction"]),
  tactic("clearance", "Clearance", ["clearance"]),
  tactic("interference", "Interference", ["interference"]),
  tactic("intermezzo", "Intermezzo", ["intermezzo"]),
  tactic("xRay", "X-ray", ["xRayAttack"]),
  tactic("sacrifice", "Sacrifice", ["sacrifice"]),
  tactic("attackingF2F7", "Attacking f2/f7", ["attackingF2F7"]),
  tactic("exposedKing", "Exposed king", ["exposedKing"]),
  tactic("advancedPawn", "Advanced pawn", ["advancedPawn"]),
  tactic("promotion", "Promotion", ["promotion", "underPromotion"]),
  tactic("quietMove", "Quiet move", ["quietMove"]),
  tactic("defensiveMove", "Defensive move", ["defensiveMove"]),
  tactic("kingsideAttack", "Kingside attack", ["kingsideAttack"]),
  tactic("queensideAttack", "Queenside attack", ["queensideAttack"]),
  tactic("zugzwang", "Zugzwang", ["zugzwang"]),

  // Mates
  mate("shortMate", "Short mates in 1–2", ["mateIn1", "mateIn2"]),
  mate("longMate", "Mates in 3 or more", ["mateIn3", "mateIn4", "mateIn5"]),
  mate("backRankMate", "Back-rank mate", ["backRankMate"]),
  mate("smotheredMate", "Smothered mate", ["smotheredMate"]),
  mate("otherMatePattern", "Other mating patterns", [
    "anastasiaMate", "arabianMate", "balestraMate", "blindSwineMate", "bodenMate",
    "cornerMate", "doubleBishopMate", "dovetailMate", "epauletteMate", "hookMate",
    "killBoxMate", "morphysMate", "operaMate", "pillsburysMate", "triangleMate", "vukovicMate",
  ]),

  // Game phase ("transition" has no Lichess theme: computed, trained positionally)
  { id: "phaseOpening", name: "Opening", family: "phase", lichessThemes: ["opening"] },
  { id: "phaseTransition", name: "Transition (moves ~12–20)", family: "phase", lichessThemes: [], fromOwnGames: true },
  { id: "phaseMiddlegame", name: "Middlegame", family: "phase", lichessThemes: ["middlegame"] },
  { id: "phaseEndgame", name: "Endgame", family: "phase", lichessThemes: ["endgame"] },

  // Endgame type
  { id: "rookEndgame", name: "Rook endgame", family: "endgame", lichessThemes: ["rookEndgame"] },
  { id: "pawnEndgame", name: "Pawn endgame", family: "endgame", lichessThemes: ["pawnEndgame"] },
  { id: "bishopEndgame", name: "Bishop endgame", family: "endgame", lichessThemes: ["bishopEndgame"] },
  { id: "knightEndgame", name: "Knight endgame", family: "endgame", lichessThemes: ["knightEndgame"] },
  { id: "queenEndgame", name: "Queen endgame", family: "endgame", lichessThemes: ["queenEndgame"] },
  { id: "queenRookEndgame", name: "Queen and rook endgame", family: "endgame", lichessThemes: ["queenRookEndgame"] },

  // Move type (computed from the user's games)
  { id: "pawnDecisions", name: "Pawn decisions", family: "moveType", lichessThemes: [], fromOwnGames: true },
  { id: "recaptureChoice", name: "Recapture choice", family: "moveType", lichessThemes: [], fromOwnGames: true },
  { id: "tradeDecisions", name: "Trade decisions", family: "moveType", lichessThemes: [], fromOwnGames: true },

  // Position state (computed from the engine evaluation).
  // Defending also uses Lichess "equality" puzzles: hold a draw from a worse position.
  // ("advantage"/"crushing" describe what a puzzle's solution wins, not a position that is
  // already won, so they don't fit "converting" and aren't used.)
  { id: "converting", name: "Converting an advantage", family: "positionState", lichessThemes: [], fromOwnGames: true },
  { id: "defending", name: "Defending a worse position", family: "positionState", lichessThemes: ["equality"], fromOwnGames: true },
  { id: "balanced", name: "Balanced positions", family: "positionState", lichessThemes: [], fromOwnGames: true },

  // Openings are labelled per game from the game record (Phase 2) and trained with
  // Lichess puzzles via their OpeningTags column, so they are not listed one by one here.
];

/** Lichess theme -> Blindspot label ids. */
const THEME_TO_LABELS: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const label of LABELS) {
    for (const theme of label.lichessThemes) {
      map.set(theme, [...(map.get(theme) ?? []), label.id]);
    }
  }
  return map;
})();

/** The Blindspot labels a Lichess puzzle trains, from its theme list. */
export function labelsForThemes(themes: string[]): string[] {
  const out = new Set<string>();
  for (const theme of themes) {
    for (const id of THEME_TO_LABELS.get(theme) ?? []) out.add(id);
  }
  return [...out];
}

/**
 * Labels that a puzzle must have at least one of to be worth storing.
 * Phase labels (opening / middlegame / endgame) are on almost every puzzle, so they
 * don't qualify a puzzle on their own.
 */
export const QUALIFYING_LABELS = new Set(
  LABELS.filter((l) => l.lichessThemes.length > 0 && l.family !== "phase").map((l) => l.id),
);

/** Labels trained (also) with "find the move" positions from the user's own games. */
export const OWN_GAME_LABELS = LABELS.filter((l) => l.fromOwnGames);

// ---------------------------------------------------------------------------
// Label keys used in the analysis (Phase 2)
// ---------------------------------------------------------------------------
//
// A mistake carries label keys:
//   - tactics and mates: "<id>:missed" or "<id>:allowed", e.g. "fork:missed"
//   - computed labels: the plain id, e.g. "phaseTransition", "rookEndgame"
//   - openings: "opening:..." keys (src/lib/analysis/openings.ts)

export type TacticSide = "missed" | "allowed";

const BY_ID = new Map(LABELS.map((l) => [l.id, l]));

/** The tactic and mate label keys for a line the Lichess tagger has tagged. */
export function tacticLabels(themes: string[], side: TacticSide): string[] {
  return labelsForThemes(themes)
    .filter((id) => BY_ID.get(id)?.missedAllowed)
    .map((id) => `${id}:${side}`);
}

/** The label behind a key: "fork:missed" -> Fork. Openings have none. */
export function labelForKey(key: string): Label | undefined {
  return BY_ID.get(key.split(":")[0]);
}

/**
 * The scoring family of a key. Each label is compared with the other labels of its family
 * ("compared with the user's average"); missed and allowed are separate families.
 */
export function familyOfKey(key: string): string {
  if (key.startsWith("opening:")) return "opening";
  const label = labelForKey(key);
  if (!label) return "unknown";
  return label.missedAllowed ? `${label.family}:${key.split(":")[1]}` : label.family;
}

/** Display name: "fork:missed" -> "Fork (missed)". Openings are named in openings.ts. */
export function describeLabelKey(key: string): string {
  const label = labelForKey(key);
  if (!label) return key;
  const side = key.split(":")[1];
  return side ? `${label.name} (${side})` : label.name;
}

/** Puzzle-store labels that train a key, or null if Lichess puzzles can't train it. */
export function puzzleLabelForKey(key: string): string | null {
  const label = labelForKey(key);
  return label && label.lichessThemes.length > 0 ? label.id : null;
}
