// How often each tactic and mate appears in the Lichess puzzle database (CC0): the number of
// puzzles in the full file carrying each label, before any filtering. Lichess puzzles come from
// real games, so this is the usual share of each motif, which the weakness profile compares
// the user's tactic mistakes with (SPEC.md -> "Scoring method").
//
// Public data, no personal information. To refresh: run the "Build puzzle store" workflow as a
// dry run and paste the "Motif frequencies" block from its log.

/** From the Lichess puzzle file as downloaded on 25 Nov 2026 (6,193,530 puzzles). */
export const MOTIF_PUZZLES: Record<string, number> = {
  fork: 795016,
  pin: 371586,
  skewer: 137063,
  discoveredAttack: 312980,
  discoveredOrDoubleCheck: 112154,
  hangingPiece: 225428,
  trappedPiece: 67913,
  captureDefender: 40449,
  deflection: 268263,
  attraction: 224811,
  clearance: 81606,
  interference: 22305,
  intermezzo: 74094,
  xRay: 22102,
  sacrifice: 467191,
  attackingF2F7: 45447,
  exposedKing: 186491,
  advancedPawn: 385402,
  promotion: 149233,
  quietMove: 259423,
  defensiveMove: 373770,
  kingsideAttack: 541607,
  queensideAttack: 93959,
  zugzwang: 64904,
  shortMate: 1734239,
  longMate: 235076,
  backRankMate: 209223,
  smotheredMate: 24506,
  otherMatePattern: 226338,
};
