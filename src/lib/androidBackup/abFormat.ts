const MAGIC = "ANDROID BACKUP";

export interface AbHeader {
  version: number;
  compressed: boolean;
  /** "none" for an unencrypted backup, or an algorithm name (e.g. "AES-256") — real Android
   * backups always name one explicitly, there's no missing/undefined case. */
  encryption: string;
  /** Byte offset where the archive body (compressed or raw tar) starts. */
  bodyOffset: number;
}

/**
 * The `.ab` format's header is 4 newline-terminated ASCII lines: magic, version, a `0`/`1`
 * compressed flag, and an encryption algorithm name — followed immediately (no line 5) by the
 * archive body, whatever line 4 says. Encrypted backups carry additional key-derivation lines
 * *inside* what would otherwise be the body, which this deliberately doesn't parse — see
 * `parseAndroidBackup` in `parseBackup.ts` for why unencrypted-only is the current scope.
 */
export function parseAbHeader(bytes: Uint8Array): AbHeader {
  let offset = 0;
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    const newline = bytes.indexOf(0x0a, offset);
    if (newline === -1) throw new Error("Not a valid Android Backup file (truncated header)");
    lines.push(new TextDecoder().decode(bytes.subarray(offset, newline)));
    offset = newline + 1;
  }
  const [magic, versionLine, compressedLine, encryption] = lines;
  if (magic !== MAGIC) throw new Error("Not a valid Android Backup file (bad magic)");
  return {
    version: Number(versionLine),
    compressed: compressedLine === "1",
    encryption,
    bodyOffset: offset,
  };
}
