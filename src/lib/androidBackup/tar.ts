export interface TarEntry {
  name: string;
  size: number;
  /** '0'/'\0' = regular file, '5' = directory — everything else (symlinks, etc.) is kept but not
   * specially handled, since Android's backup tar writer only realistically emits these two. */
  typeflag: string;
  data: Uint8Array;
}

const BLOCK_SIZE = 512;

function readString(block: Uint8Array, start: number, length: number): string {
  let end = start;
  while (end < start + length && block[end] !== 0) end++;
  return new TextDecoder().decode(block.subarray(start, end));
}

function readOctal(block: Uint8Array, start: number, length: number): number {
  const str = readString(block, start, length).trim();
  return str ? parseInt(str, 8) : 0;
}

function isZeroBlock(block: Uint8Array): boolean {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false;
  return true;
}

/**
 * Best-effort POSIX/ustar reader for the tar stream inside a decompressed `.ab` body. Handles the
 * `ustar` prefix field (name split across `name`+`prefix` when the path is long) and GNU's
 * `L`-typeflag long-name extension (Android backup paths like
 * `apps/<pkg>/f/some/deeply/nested/file` regularly exceed the 100-byte plain tar name field) —
 * anything else non-standard is passed through with whatever name tar gives it rather than
 * rejected outright, consistent with this app's "best-effort, don't crash on the unusual case"
 * posture.
 */
export function parseTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingLongName: string | null = null;

  while (offset + BLOCK_SIZE <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK_SIZE);
    if (isZeroBlock(header)) break; // end-of-archive marker

    let name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] || 0) || "0";

    offset += BLOCK_SIZE;
    const data = bytes.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    if (typeflag === "L") {
      // GNU long-name entry: its "data" is the real name (NUL-terminated) for the *next* header.
      pendingLongName = readString(data, 0, data.length);
      continue;
    }
    if (pendingLongName) {
      name = pendingLongName;
      pendingLongName = null;
    }
    entries.push({ name, size, typeflag, data });
  }

  return entries;
}
