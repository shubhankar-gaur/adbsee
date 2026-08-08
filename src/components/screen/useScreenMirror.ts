import { useSyncExternalStore } from "react";
import type { Adb, AdbShellProtocolSubprocessService } from "@yume-chan/adb";
import { AccessUnitReader, findSpsProfileLevel, type AccessUnit } from "./h264NalParser";

export interface ScreenMirrorOptions {
  bitRate?: number;
  /** Longest edge (px) to downscale device capture to before encoding, or 0 to capture at native
   * resolution. Native resolution was tried as the default and made things worse, not better: the
   * bit-rate target below is a fixed budget, so spreading it over many more pixels means more
   * compression blockiness per pixel, not less — and the encoder/decoder both have more pixels to
   * push through per frame in the same time budget, so frame rate drops too ("slow animations").
   * Capping this is a straight win on both quality *and* speed for anything but a very fast link,
   * which is why it's back to being the default. Tap/swipe coordinates are unaffected either way —
   * see `nativeSize` below. */
  maxSize?: number;
}

// screenrecord's own hard limit is ~180s; stop a little early and reconnect rather than
// having the device cut us off mid-frame.
const TIME_LIMIT_SECONDS = 175;
const DEFAULT_MAX_SIZE = 1280;
const UNSUPPORTED = typeof VideoDecoder === "undefined";

// Module-level singleton (not per-component state) so the running mirror survives whichever
// component happens to be displaying it unmounting — the same reasoning as useShellSession.ts's
// PTY singleton, except multiple, possibly-not-yet-mounted consumers (the Screen tab and the
// cross-tab dock) all need to observe and control the *same* instance, so this uses
// useSyncExternalStore instead.
interface MirrorSnapshot {
  running: boolean;
  error: string | null;
  /** The device's real display resolution — `input tap`/`input swipe` coordinates are always in
   * this space, completely independent of whatever resolution `screenrecord --size` happens to be
   * capturing/encoding at. Consumers need this to scale a click on the (possibly downscaled)
   * canvas back up to real device coordinates; `null` means either mirroring hasn't queried it
   * yet, or capture is running at native resolution already (nothing to scale). */
  nativeSize: { width: number; height: number } | null;
}

let snapshot: MirrorSnapshot = { running: false, error: null, nativeSize: null };
const listeners = new Set<() => void>();

function setSnapshot(patch: Partial<MirrorSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): MirrorSnapshot {
  return snapshot;
}

let frameCallback: ((frame: VideoFrame) => void) | null = null;
let killCurrent: (() => void) | null = null;

// Bumped on every start/stop. `runOneSession`'s loop, its decoder callbacks, and the reconnect
// loop all check `gen === generation` before touching shared state — without this, calling
// startMirror() again shortly after stopMirror() (very easy to do by hand) could race: the old
// session's async cleanup hadn't finished setting `running: false` yet, so the new start() call
// would see `running: true` and silently no-op, or — worse — both the old (still unwinding) and
// new session could end up decoding and drawing frames at once, corrupting the canvas.
let generation = 0;

export function setMirrorFrameCallback(cb: ((frame: VideoFrame) => void) | null): void {
  frameCallback = cb;
}

/** `wm size`'s output looks like `Physical size: 1080x2400`, plus an `Override size: ...` line
 * when a forced density/size override is active — that override is what actually governs
 * `screenrecord`'s native capture resolution, so it takes priority when present. Best-effort:
 * `null` (unparseable output, or the query itself failing) just means capture falls back to
 * native resolution instead of scaling, same posture as every other dumpsys/wm text scrape here. */
async function getDeviceSize(
  shellProtocol: AdbShellProtocolSubprocessService,
): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await shellProtocol.spawnWaitText(["wm", "size"]);
    const match = /Override size:\s*(\d+)x(\d+)/.exec(stdout) ?? /Physical size:\s*(\d+)x(\d+)/.exec(stdout);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
  } catch {
    return null;
  }
}

// AVC hardware encoders commonly require macroblock-aligned dimensions; 16 is the safe common
// denominator across devices (some tolerate less, none need more).
function roundToMultiple(n: number, multiple: number): number {
  return Math.max(multiple, Math.round(n / multiple) * multiple);
}

function scaledSize(width: number, height: number, maxSize: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxSize ? maxSize / longest : 1;
  return {
    width: roundToMultiple(Math.round(width * scale), 16),
    height: roundToMultiple(Math.round(height * scale), 16),
  };
}

function buildCodecString(unit: AccessUnit): string {
  const sps = unit.isKeyframe ? findSpsProfileLevel(unit.data) : null;
  if (!sps) return "avc1.640028"; // fallback guess; shouldn't normally be needed
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `avc1.${hex(sps.profileIdc)}${hex(sps.constraintFlags)}${hex(sps.levelIdc)}`;
}

async function runOneSession(
  shellProtocol: AdbShellProtocolSubprocessService,
  bitRate: number,
  maxSize: number,
  gen: number,
): Promise<void> {
  // Queried fresh per session (not just once for the whole mirror lifetime) so a reconnect after
  // a device rotation picks up the new orientation's dimensions too.
  const deviceSize = maxSize > 0 ? await getDeviceSize(shellProtocol) : null;
  const size = deviceSize ? scaledSize(deviceSize.width, deviceSize.height, maxSize) : null;
  if (gen !== generation) return; // superseded while we were awaiting the size query
  // Published even when `size` ends up equal to native (nothing to scale) — cheap either way, and
  // simpler than conditionally publishing based on whether scaling actually happened.
  if (deviceSize) setSnapshot({ nativeSize: deviceSize });

  const process = await shellProtocol.spawn([
    "screenrecord",
    "--output-format=h264",
    `--bit-rate=${bitRate}`,
    ...(size ? [`--size=${size.width}x${size.height}`] : []),
    `--time-limit=${TIME_LIMIT_SECONDS}`,
    "-",
  ]);
  killCurrent = () => void process.kill();

  const decoder = new VideoDecoder({
    output: (frame) => {
      if (gen === generation && frameCallback) {
        frameCallback(frame);
      } else {
        frame.close();
      }
    },
    error: (e) => {
      if (gen === generation) setSnapshot({ error: e.message });
    },
  });

  let configured = false;
  const assembler = new AccessUnitReader();

  const feed = (unit: AccessUnit) => {
    if (gen !== generation) return; // a stale session — a newer one has already taken over
    if (!configured) {
      // The first keyframe carries the in-band SPS/PPS that Annex-B decoding needs. Deriving the
      // codec string from that real SPS (instead of guessing a fixed profile/level) avoids
      // `configure()` rejecting encoder output whose actual profile differs from the guess.
      if (!unit.isKeyframe) return;
      decoder.configure({
        codec: buildCodecString(unit),
        avc: { format: "annexb" },
        // Asks the decoder to emit each frame the moment it's individually decoded rather than
        // buffering to allow reordering — `screenrecord`'s H264 output has no B-frames, so there's
        // nothing to reorder, and buffering here only adds pure latency for no benefit.
        optimizeForLatency: true,
      });
      configured = true;
    }
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: unit.isKeyframe ? "key" : "delta",
          timestamp: performance.now() * 1000,
          data: unit.data,
        }),
      );
    } catch {
      // The codec can close itself after a fatal internal error (WebCodecs spec — see the
      // `error` callback above and the cleanup path below), after which every further decode()
      // call throws. Kill this session's process so the read loop below ends and the outer
      // reconnect loop starts a fresh session/decoder, instead of letting this propagate as an
      // unhandled rejection that would stop mirroring outright.
      void process.kill();
    }
  };

  const reader = process.stdout.getReader();
  try {
    for (;;) {
      if (gen !== generation) break;
      const { value, done } = await reader.read();
      if (done) break;
      for (const unit of assembler.push(value)) feed(unit);
    }
    const last = assembler.flushRemaining();
    if (last) feed(last);
  } finally {
    reader.releaseLock();
    // A fatal decode error can make the browser close the codec automatically (per the
    // WebCodecs spec) while this flush is in flight — checking `decoder.state` before the
    // `await` doesn't help, since the state can change during it. try/catch handles that race
    // (and the already-closed case in general) regardless of exactly when it happens.
    await decoder.flush().catch(() => {});
    try {
      decoder.close();
    } catch {
      // Already closed — nothing left to clean up.
    }
  }
}

/** Usable from anywhere, not just inside a component — e.g. a one-click action with no UI of its own. */
export function startMirror(adb: Adb, options: ScreenMirrorOptions = {}): void {
  if (UNSUPPORTED) return;
  const shellProtocol = adb.subprocess.shellProtocol;
  if (!shellProtocol) {
    setSnapshot({
      error: "This device doesn't support the ADB shell protocol needed for clean video capture.",
    });
    return;
  }

  // Supersede whatever's currently running (or still unwinding) immediately, rather than
  // bailing out because `running` looked stale.
  generation++;
  const gen = generation;
  killCurrent?.();
  killCurrent = null;
  setSnapshot({ running: true, error: null, nativeSize: null });
  const bitRate = options.bitRate ?? 8_000_000;
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;

  void (async () => {
    try {
      while (gen === generation) {
        await runOneSession(shellProtocol, bitRate, maxSize, gen);
      }
    } catch (err) {
      if (gen === generation) setSnapshot({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (gen === generation) setSnapshot({ running: false });
    }
  })();
}

export function stopMirror(): void {
  generation++;
  killCurrent?.();
  killCurrent = null;
  setSnapshot({ running: false });
}

/** Call when the ADB connection is torn down entirely, not on every component unmount. */
export function disposeScreenMirror(): void {
  stopMirror();
  frameCallback = null;
}

export function useScreenMirror(adb: Adb | null) {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  return {
    running: state.running,
    error: state.error,
    nativeSize: state.nativeSize,
    unsupported: UNSUPPORTED,
    start: (options?: ScreenMirrorOptions) => {
      if (adb) startMirror(adb, options);
    },
    stop: stopMirror,
    setOnFrame: setMirrorFrameCallback,
  };
}
