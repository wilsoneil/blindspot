// The fixed list of weakness labels (SPEC.md -> "Categories").
//
// Every label maps either to Lichess puzzle themes (so Lichess puzzles can train it)
// or is "positional": computed by Blindspot itself and trained with "find the move"
// positions from the user's own games (Phase 3).
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

  // Mates
  mate("shortMate", "Short mates (in 1–2)", ["mateIn1", "mateIn2"]),
  mate("longMate", "Longer mates (3+)", ["mateIn3", "mateIn4", "mateIn5"]),
  mate("backRankMate", "Back-rank mate", ["backRankMate"]),
  mate("smotheredMate", "Smothered mate", ["smotheredMate"]),
  mate("otherMatePattern", "Other mating patterns", [
    "anastasiaMate", "arabianMate", "balestraMate", "blindSwineMate", "bodenMate",
    "cornerMate", "doubleBishopMate", "dovetailMate", "epauletteMate", "hookMate",
    "killBoxMate", "morphysMate", "operaMate", "pillsburysMate", "triangleMate", "vukovicMate",
  ]),

  // Game phase ("transition" has no Lichess theme: computed, trained positionally)
  { id: "phaseOpening", name: "Opening", family: "phase", lichessThemes: ["opening"] },
  { id: "phaseTransition", name: "Transition (moves ~12–20)", family: "phase", lichessThemes: [] },
  { id: "phaseMiddlegame", name: "Middlegame", family: "phase", lichessThemes: ["middlegame"] },
  { id: "phaseEndgame", name: "Endgame", family: "phase", lichessThemes: ["endgame"] },

  // Endgame type
  { id: "rookEndgame", name: "Rook endgame", family: "endgame", lichessThemes: ["rookEndgame"] },
  { id: "pawnEndgame", name: "Pawn endgame", family: "endgame", lichessThemes: ["pawnEndgame"] },
  { id: "bishopEndgame", name: "Bishop endgame", family: "endgame", lichessThemes: ["bishopEndgame"] },
  { id: "knightEndgame", name: "Knight endgame", family: "endgame", lichessThemes: ["knightEndgame"] },
  { id: "queenEndgame", name: "Queen endgame", family: "endgame", lichessThemes: ["queenEndgame"] },
  { id: "queenRookEndgame", name: "Queen and rook endgame", family: "endgame", lichessThemes: ["queenRookEndgame"] },

  // Move type (computed, positional)
  { id: "pawnDecisions", name: "Pawn decisions", family: "moveType", lichessThemes: [] },
  { id: "recaptureChoice", name: "Recapture choice", family: "moveType", lichessThemes: [] },
  { id: "tradeDecisions", name: "Trade decisions", family: "moveType", lichessThemes: [] },

  // Position state (computed from the engine evaluation, positional)
  { id: "converting", name: "Converting an advantage", family: "positionState", lichessThemes: [] },
  { id: "defending", name: "Defending a worse position", family: "positionState", lichessThemes: [] },
  { id: "balanced", name: "Balanced positions", family: "positionState", lichessThemes: [] },

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

export const POSITIONAL_LABELS = LABELS.filter((l) => l.lichessThemes.length === 0);
