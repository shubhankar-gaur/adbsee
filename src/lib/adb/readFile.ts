import { escapeArg, type Adb } from "@yume-chan/adb";
import type { ReadableStream } from "@yume-chan/stream-extra";
import { suCommand, suShellCommand } from "./suCommand";
import { runAsCommand, runAsShellCommand } from "./runAsCommand";

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (bytesRead: number) => void,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    onProgress?.(total);
  }
  return concatChunks(chunks, total);
}

/** Reads an entire file. Only call this once the caller has already decided the size is sane. */
export async function readFileFull(
  adb: Adb,
  remotePath: string,
  onProgress?: (bytesRead: number) => void,
): Promise<Uint8Array> {
  const sync = await adb.sync();
  try {
    return await readAll(sync.read(remotePath), onProgress);
  } finally {
    await sync.dispose();
  }
}

/**
 * Reads at most `maxBytes` from the start of a file, then cancels the reader and disposes —
 * never drains the rest of a large file just to preview the beginning of it.
 */
export async function readFileHead(
  adb: Adb,
  remotePath: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const sync = await adb.sync();
  try {
    const reader = sync.read(remotePath).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        if (total >= maxBytes) {
          truncated = true;
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const combined = concatChunks(chunks, total);
    return { bytes: truncated ? combined.subarray(0, maxBytes) : combined, truncated };
  } finally {
    await sync.dispose();
  }
}

/**
 * Runs a read-only, already-privilege-wrapped command and returns its raw stdout. Used for paths
 * the unprivileged sync connection can't reach (e.g. another app's `/data/data/<pkg>`, whether
 * via root or `run-as`). Prefers the shell protocol for clean stdout/stderr separation — the
 * none-protocol fallback merges them, which risks a stray stderr message corrupting binary
 * output, so it's only used when shell protocol is unavailable at all.
 */
async function runReadCommand(
  adb: Adb,
  command: string[],
  onProgress?: (bytesRead: number) => void,
): Promise<Uint8Array> {
  const shellProtocol = adb.subprocess.shellProtocol;
  if (shellProtocol) {
    const process = await shellProtocol.spawn(command);
    return readAll(process.stdout, onProgress);
  }
  // No incremental read here (spawnWait resolves with the whole buffer at once), so progress
  // isn't reported on this fallback path — a rarer combination (privileged mode without shell
  // protocol).
  return adb.subprocess.noneProtocol.spawnWait(command);
}

/** Root-privileged equivalent of `readFileFull`, via `su -c cat`. */
export async function readFileRootFull(
  adb: Adb,
  remotePath: string,
  onProgress?: (bytesRead: number) => void,
): Promise<Uint8Array> {
  return runReadCommand(adb, suCommand(["cat", remotePath]), onProgress);
}

/**
 * Root-privileged equivalent of `readFileHead`, via `su -c head -c`. Unlike the sync-based
 * version, the truncation happens device-side (asking for one extra byte to detect it) — so a
 * huge file never gets pulled over the wire just to preview the start of it.
 */
export async function readFileRootHead(
  adb: Adb,
  remotePath: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const bytes = await runReadCommand(
    adb,
    suCommand(["head", "-c", String(maxBytes + 1), remotePath]),
  );
  if (bytes.length > maxBytes) {
    return { bytes: bytes.subarray(0, maxBytes), truncated: true };
  }
  return { bytes, truncated: false };
}

/** `run-as <pkg>` equivalent of `readFileRootFull` — no root needed, only works for a debuggable
 * app's own private data. */
export async function readFileRunAsFull(
  adb: Adb,
  pkg: string,
  remotePath: string,
  onProgress?: (bytesRead: number) => void,
): Promise<Uint8Array> {
  return runReadCommand(adb, runAsCommand(pkg, ["cat", remotePath]), onProgress);
}

/** `run-as <pkg>` equivalent of `readFileRootHead`. */
export async function readFileRunAsHead(
  adb: Adb,
  pkg: string,
  remotePath: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const bytes = await runReadCommand(
    adb,
    runAsCommand(pkg, ["head", "-c", String(maxBytes + 1), remotePath]),
  );
  if (bytes.length > maxBytes) {
    return { bytes: bytes.subarray(0, maxBytes), truncated: true };
  }
  return { bytes, truncated: false };
}

// `tail -c +N` seeks on a regular (non-pipe) file rather than reading byte-by-byte, so this stays
// cheap even for an offset deep into a large file — unlike `dd bs=1`, which would need one
// syscall per skipped byte. `-c +N` is 1-indexed (starts *at* byte N), hence the `offset + 1`.
function rangeSnippet(path: string, offset: number, length: number): string {
  return `tail -c +${offset + 1} ${escapeArg(path)} | head -c ${length}`;
}

/** Reads an arbitrary `[offset, offset+length)` byte range — for scrubbing through a file too
 * large to preview in full, rather than only ever loading from the start. Works even without
 * root: any file the plain sync connection can already read, the unprivileged shell can too. */
export async function readFileRange(
  adb: Adb,
  remotePath: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  return runReadCommand(adb, [rangeSnippet(remotePath, offset, length)]);
}

/** Root-privileged equivalent of `readFileRange`. */
export async function readFileRootRange(
  adb: Adb,
  remotePath: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  return runReadCommand(adb, suShellCommand(rangeSnippet(remotePath, offset, length)));
}

/** `run-as <pkg>` equivalent of `readFileRange`. */
export async function readFileRunAsRange(
  adb: Adb,
  pkg: string,
  remotePath: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  return runReadCommand(adb, runAsShellCommand(pkg, rangeSnippet(remotePath, offset, length)));
}
