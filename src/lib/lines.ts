// Reads a big text file line by line, unpacking it first if it is zstd-compressed.
//
// Whether to unpack is decided from the file's first bytes, not its name: a download can
// arrive already unpacked (if the server marks it as compressed, Node's fetch unpacks it
// on the way in). Any error, from the network or from unpacking, stops the loop with
// that error instead of ending quietly as if the file were empty.

import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createZstdDecompress } from "node:zlib";

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function isZstd(firstBytes: Uint8Array): boolean {
  return firstBytes.length >= 4 && ZSTD_MAGIC.equals(Buffer.from(firstBytes.subarray(0, 4)));
}

export async function* readLines(source: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const iterator = source[Symbol.asyncIterator]();

  // Gather at least 4 bytes, enough to recognise the zstd marker.
  const head: Uint8Array[] = [];
  let headLength = 0;
  let ended = false;
  while (headLength < 4) {
    const next = await iterator.next();
    if (next.done) { ended = true; break; }
    head.push(next.value);
    headLength += next.value.length;
  }
  if (headLength === 0) return;
  const start = Buffer.concat(head);

  // Put those first bytes back in front of the rest.
  async function* whole() {
    yield start;
    if (ended) return;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value;
  }

  let chunks: AsyncIterable<Uint8Array>;
  if (isZstd(start)) {
    const unzip = createZstdDecompress();
    Readable.from(whole()).on("error", (e) => unzip.destroy(e)).pipe(unzip);
    chunks = unzip; // iterating a stream rethrows its errors
  } else {
    chunks = whole();
  }

  const decoder = new StringDecoder("utf8");
  let rest = "";
  for await (const chunk of chunks) {
    const lines = (rest + decoder.write(Buffer.from(chunk))).split("\n");
    rest = lines.pop()!;
    for (const line of lines) yield line.replace(/\r$/, "");
  }
  rest += decoder.end();
  if (rest) yield rest.replace(/\r$/, "");
}
