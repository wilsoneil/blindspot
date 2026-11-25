# Stockfish for the browser

The engine behind the optional evaluation on the analysis board (SPEC.md -> "Puzzle experience").

- **Files:** `stockfish-18-lite-single.js` and `stockfish-18-lite-single.wasm`, copied unchanged from the
  npm package `stockfish@18.0.8` (`bin/`). The lite single-threaded build: about 7 MB, and it needs no
  special server headers (the multi-threaded builds need cross-origin isolation).
- **Source:** Stockfish.js by Nathan Rugg and Chess.com, https://github.com/nmrugg/stockfish.js, based on
  Stockfish, https://github.com/official-stockfish/Stockfish.
- **Licence:** GPL-3.0 (see `COPYING.txt`). The source code is available at the links above.
- **Updating:** `npm pack stockfish@<version>`, unpack it and copy the two `lite-single` files here, renamed
  if the version in the file name changes (and update `ENGINE_URL` in `src/app/train/use-stockfish.ts`).
