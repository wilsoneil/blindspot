// Opening weaknesses -> Lichess puzzles (SPEC.md -> "Openings by colour").
//
// Lichess tags each puzzle from a game's opening with OpeningTags such as
// "Italian_Game Italian_Game_Two_Knights_Defense". Blindspot's opening weaknesses are keyed
// by chess.com names (White) or by the user's reply to White's first move (Black), so:
//
//   - White variation / family: the chess.com name written as a Lichess tag, trying the full
//     variation first, then shorter names down to the family, and using the first that has
//     puzzles. ("Italian Game Two Knights Defense" -> "Italian_Game_Two_Knights_Defense", then
//     "Italian_Game_Two_Knights", ... "Italian_Game".)
//   - Black reply / first move: the Lichess opening families each reply leads to (table below).
//     A tag that no stored puzzle carries simply finds nothing, so the table can be generous.
//   - "Offbeat openings" pools rare openings and isn't trainable as such.

import { familyName } from "../analysis/openings";

/** "King's Indian Defense" -> "Kings_Indian_Defense", "Grünfeld Defense" -> "Grunfeld_Defense". */
export function lichessTag(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // accents
    .replace(/['’.,:()]/g, "")
    .trim().split(/\s+/).join("_");
}

/** Tags to try for a White opening, most specific first, down to its family. */
export function whiteCandidates(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const familyWords = familyName(name).split(" ").length;
  const out: string[] = [];
  for (let n = words.length; n >= Math.min(familyWords, words.length); n--) out.push(lichessTag(words.slice(0, n).join(" ")));
  return out;
}

const E5 = [
  "Italian_Game", "Ruy_Lopez", "Scotch_Game", "Kings_Gambit", "Kings_Gambit_Accepted", "Kings_Gambit_Declined",
  "Russian_Game", "Petrovs_Defense", "Philidor_Defense", "Four_Knights_Game", "Three_Knights_Opening", "Kings_Pawn_Game",
  "Vienna_Game", "Bishops_Opening", "Ponziani_Opening", "Center_Game", "Elephant_Gambit", "Latvian_Gambit",
  "Scotch_Gambit", "Danish_Gambit", "Kings_Knight_Opening",
];
const E4_OTHER = [
  "Sicilian_Defense", "French_Defense", "Caro-Kann_Defense", "Scandinavian_Defense", "Alekhine_Defense", "Pirc_Defense",
  "Modern_Defense", "Nimzowitsch_Defense", "Owen_Defense", "St_George_Defense",
];
const D5 = [
  "Queens_Gambit_Declined", "Queens_Gambit_Accepted", "Queens_Gambit", "Slav_Defense", "Semi-Slav_Defense",
  "Queens_Pawn_Game", "Tarrasch_Defense", "Blackmar-Diemer_Gambit", "Richter-Veresov_Attack", "Chigorin_Defense",
  "Albin_Countergambit", "Baltic_Defense",
];
const NF6 = [
  "Indian_Defense", "Kings_Indian_Defense", "Nimzo-Indian_Defense", "Queens_Indian_Defense", "Grunfeld_Defense",
  "Bogo-Indian_Defense", "Benoni_Defense", "Modern_Benoni", "Benko_Gambit", "Catalan_Opening", "Budapest_Defense",
  "Old_Indian_Defense", "Trompowsky_Attack", "Queens_Pawn_Game",
];
const D4_OTHER = ["Dutch_Defense", "Horwitz_Defense", "Modern_Defense", "Englund_Gambit", "Owen_Defense", "Queens_Pawn_Game"];

/** Lichess families after White's first move and the user's reply (SAN). */
const BLACK_REPLIES: Record<string, string[]> = {
  "e4 e5": E5,
  "e4 c5": ["Sicilian_Defense"],
  "e4 e6": ["French_Defense"],
  "e4 c6": ["Caro-Kann_Defense"],
  "e4 d5": ["Scandinavian_Defense"],
  "e4 Nf6": ["Alekhine_Defense"],
  "e4 d6": ["Pirc_Defense"],
  "e4 g6": ["Modern_Defense", "Pirc_Defense"],
  "e4 Nc6": ["Nimzowitsch_Defense"],
  "e4 b6": ["Owen_Defense"],
  "d4 d5": D5,
  "d4 Nf6": NF6,
  "d4 f5": ["Dutch_Defense"],
  "d4 e6": ["Horwitz_Defense", "French_Defense", "Queens_Gambit_Declined"],
  "d4 g6": ["Modern_Defense", "Kings_Indian_Defense", "Grunfeld_Defense"],
  "d4 d6": ["Old_Indian_Defense", "Pirc_Defense", "Modern_Defense"],
  "d4 e5": ["Englund_Gambit"],
  "d4 c5": ["Benoni_Defense", "Old_Benoni_Defense"],
};

/** Lichess families after White's first move (the user's other replies, pooled). */
const BLACK_FIRST_MOVES: Record<string, string[]> = {
  e4: [...E5, ...E4_OTHER],
  d4: [...D5, ...NF6, ...D4_OTHER],
  c4: ["English_Opening"],
  Nf3: ["Zukertort_Opening", "Reti_Opening", "Kings_Indian_Attack"],
  f4: ["Bird_Opening"],
  b3: ["Nimzo-Larsen_Attack"],
  g3: ["Hungarian_Opening", "Kings_Indian_Attack"],
};

/**
 * The OpeningTags sets to try for an opening key, in order: each set matches puzzles carrying
 * any of its tags. Empty when the key can't be trained (Offbeat, or an unknown reply).
 */
export function openingCandidates(key: string): string[][] {
  const [, level, ...rest] = key.split(":");
  const value = rest.join(":");
  switch (level) {
    case "w":
    case "wf":
      return whiteCandidates(value).map((t) => [t]);
    case "b": {
      const tags = BLACK_REPLIES[value];
      if (tags) return [tags];
      const first = value.split(" ")[0];
      return BLACK_FIRST_MOVES[first] ? [BLACK_FIRST_MOVES[first]] : [];
    }
    case "bf":
      return BLACK_FIRST_MOVES[value] ? [BLACK_FIRST_MOVES[value]] : [];
    default:
      return [];
  }
}
