import type { Adb } from "@yume-chan/adb";

const BACKUP_MAGIC = "ANDROID BACKUP";

export interface BackupAttempt {
  /** Resolves with whatever bytes were captured once the stream ends — naturally (device
   * finished) or via `cancel()`. */
  result: Promise<Uint8Array>;
  /** Kills the spawned process — needed because some devices show an on-device confirmation
   * dialog that blocks the backup stream until a human taps it, and there's no way to drive that
   * dialog from here. */
  cancel: () => void;
}

/**
 * Runs `bu backup <pkg>` and captures its raw stdout — the Android Backup (.ab) format stream.
 * `adb backup -f out.ab <pkg>` (the host-side CLI) does exactly this and nothing more; `-f` only
 * tells the *host* where to save the bytes it receives, so driving `bu backup` directly over an
 * existing shell connection reproduces the same capability without needing a distinct backup
 * protocol. Prefers the shell protocol so stdout isn't mixed with stderr (binary data corrupted
 * by a stray diagnostic line would be silently wrong rather than loudly broken).
 *
 * Many apps (API 29+, or their own backup rules) make this come back empty rather than erroring
 * outright — that's reported as a zero/short byte count with no valid header, not an exception,
 * since it's an expected, common outcome rather than a failure of this code.
 */
export function attemptBackup(
  adb: Adb,
  pkg: string,
  onProgress: (bytesRead: number) => void,
): BackupAttempt {
  const command = ["bu", "backup", pkg];
  let kill: (() => void) | null = null;
  let cancelled = false;

  const result = (async () => {
    const shellProtocol = adb.subprocess.shellProtocol;
    const stdout = shellProtocol
      ? await shellProtocol.spawn(command).then((process) => {
          kill = () => void process.kill();
          return process.stdout;
        })
      : await adb.subprocess.noneProtocol.spawn(command).then((process) => {
          kill = () => void process.kill();
          return process.output;
        });

    const reader = stdout.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        onProgress(total);
      }
    } catch (err) {
      if (!cancelled) throw err;
    }

    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  })();

  return {
    result,
    cancel: () => {
      cancelled = true;
      kill?.();
    },
  };
}

/** A real Android Backup stream starts with a fixed literal magic header — anything else (an
 * empty stream, an error page, garbage) means the backup didn't actually happen. */
export function looksLikeValidBackup(bytes: Uint8Array): boolean {
  if (bytes.length < BACKUP_MAGIC.length) return false;
  return new TextDecoder().decode(bytes.subarray(0, BACKUP_MAGIC.length)) === BACKUP_MAGIC;
}
