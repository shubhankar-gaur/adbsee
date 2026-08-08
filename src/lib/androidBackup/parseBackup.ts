import { unzlibSync } from "fflate";
import { parseAbHeader } from "./abFormat";
import { parseTar, type TarEntry } from "./tar";

export interface ParsedBackup {
  version: number;
  entries: TarEntry[];
}

/**
 * Unpacks a captured `.ab` stream (see `attemptBackup` in `../adb/backupAttempt.ts`) into its tar
 * entries — unencrypted backups only for now. An `AES-256` backup needs a password-derived master
 * key before there's anything to inflate/untar at all, which is real crypto work rather than
 * format parsing, so it's reported as a clear error instead of attempted.
 */
export function parseAndroidBackup(bytes: Uint8Array): ParsedBackup {
  const header = parseAbHeader(bytes);
  if (header.encryption !== "none") {
    throw new Error(
      `This backup is encrypted (${header.encryption}) — password-protected backups aren't supported yet.`,
    );
  }
  const body = bytes.subarray(header.bodyOffset);
  const tarBytes = header.compressed ? unzlibSync(body) : body;
  return { version: header.version, entries: parseTar(tarBytes) };
}
