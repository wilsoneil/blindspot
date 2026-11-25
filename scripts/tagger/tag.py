"""Tags lines from Blindspot's analysis with the Lichess puzzle tagger.

The tagger (https://github.com/ornicar/lichess-puzzler, AGPL-3.0) is not copied into this
repository: the analysis workflow downloads a pinned version of it and passes its folder in.

Protocol: one JSON object per line on stdin, one per line on stdout, in the same order.
  in:  {"fen": "...", "moves": ["e2e4", ...], "cp": 350}
       moves[0] sets the puzzle (as in Lichess puzzles); the solver plays moves[1], [3], ...
       cp is the solver's evaluation (forced mates as +-10000).
  out: {"themes": ["fork", ...], "line": [...]}  or  {"error": "..."}

The engine's best line can run on long after the tactic is over, and the tagger expects a
puzzle-length line, so it is first trimmed: a forced mate is kept to the mate; otherwise the
line stops at the solver move that wins the most material (within 4 solver moves).

Run the built-in check:  python3 scripts/tagger/tag.py --tagger <dir> --self-test
"""

import argparse
import json
import logging
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--tagger", required=True, help="the lichess-puzzler/tagger folder")
parser.add_argument("--engine", help="Stockfish, for the zugzwang check (skipped without it)")
parser.add_argument("--nodes", type=int, default=300_000)
parser.add_argument("--self-test", action="store_true")
args = parser.parse_args()

sys.path.insert(0, args.tagger)
import chess  # noqa: E402
import chess.engine  # noqa: E402
from chess.pgn import Game  # noqa: E402

import cook  # noqa: E402
import zugzwang as zug  # noqa: E402
from model import Puzzle  # noqa: E402
from util import material_diff  # noqa: E402

logging.disable(logging.WARNING)  # the tagger logs puzzle links, python-chess notes null moves: not useful here

MAX_SOLVER_MOVES = 4
engine = None
if args.engine:
    engine = chess.engine.SimpleEngine.popen_uci(args.engine)
    engine.configure({"Threads": 1, "Hash": 64})
    limit = chess.engine.Limit(nodes=args.nodes)

    def score_of(eng, board, pov):  # replaces the tagger's own (which prints, and searches far deeper)
        return eng.analyse(board, limit=limit)["score"].pov(pov)

    zug.score_of = score_of


def legal_prefix(board, ucis):
    b = board.copy()
    moves = []
    for uci in ucis:
        move = chess.Move.from_uci(uci)
        if move not in b.legal_moves:
            break
        b.push(move)
        moves.append(move)
    return moves


def trim(board, moves, pov):
    b = board.copy()
    for i, move in enumerate(moves):
        b.push(move)
        if b.is_checkmate():
            if i % 2 == 1:  # the solver mates
                return moves[: i + 1]
            return moves[: max(i, 2)]
    window = moves[: 2 * MAX_SOLVER_MOVES]
    b = board.copy()
    b.push(window[0])
    base = material_diff(b, pov)
    best_end, best_gain = 2, 0
    for j in range(1, len(window), 2):
        b.push(window[j])
        settled = b.copy()
        if j + 1 < len(window):
            settled.push(window[j + 1])
        gain = material_diff(settled, pov) - base
        if gain > best_gain:
            best_gain, best_end = gain, j + 1
        if j + 1 < len(window):
            b.push(window[j + 1])
    return window[:best_end]


def tag(request):
    board = chess.Board(request["fen"])
    moves = legal_prefix(board, request["moves"])
    if len(moves) < 2:
        return {"themes": [], "line": [m.uci() for m in moves]}
    pov = not board.turn  # the solver: the side NOT making the first move
    moves = trim(board, moves, pov)
    node = Game.from_board(board)
    for move in moves:
        node = node.add_main_variation(move)
    puzzle = Puzzle("blindspot", node.game(), int(request["cp"]))
    themes = cook.cook(puzzle)
    if engine and zug.zugzwang(engine, puzzle):
        themes.append("zugzwang")
    return {"themes": themes, "line": [m.uci() for m in moves]}


def self_test():
    cases = [
        # Black blunders a pawn move; White's knight forks king and rook.
        ({"fen": "r3k3/7p/8/3N4/8/8/7P/4K3 b - - 0 1", "moves": ["h7h6", "d5c7", "e8d7", "c7a8", "d7c7"], "cp": 500}, "fork"),
        # Black moves the bishop away; White mates on the back rank.
        ({"fen": "6k1/5ppp/8/8/8/8/1b3PPP/R5K1 b - - 0 1", "moves": ["b2c3", "a1a8"], "cp": 10000}, "backRankMate"),
        ({"fen": "6k1/5ppp/8/8/8/8/1b3PPP/R5K1 b - - 0 1", "moves": ["b2c3", "a1a8"], "cp": 10000}, "mateIn1"),
    ]
    ok = True
    for request, expected in cases:
        themes = tag(request)["themes"]
        passed = expected in themes
        ok = ok and passed
        print(f"{'ok  ' if passed else 'FAIL'} expected {expected}: got {' '.join(themes)}")
    return ok


def serve():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            result = tag(json.loads(line))
        except Exception as e:  # one bad line shouldn't stop the job; it just gets no tags
            result = {"error": f"{type(e).__name__}: {e}"}
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()
    return True


try:
    passed = self_test() if args.self_test else serve()
finally:
    if engine:
        engine.quit()  # otherwise the engine's helper thread keeps Python running
sys.exit(0 if passed else 1)
