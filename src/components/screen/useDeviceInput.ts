import { escapeArg, type Adb } from "@yume-chan/adb";

// A persistent-shell version of this (writing `input ...` lines into one long-lived `sh`'s stdin
// instead of spawning a fresh ADB shell service per event) was tried to cut per-event latency, but
// broke taps/swipes outright on real hardware in a way that wasn't safely diagnosable without
// device access — reverted in favor of the simple, previously-proven-correct one-shot spawn.
async function input(adb: Adb, args: string[]): Promise<void> {
  await adb.subprocess.noneProtocol.spawnWaitText(["input", ...args]);
}

export function useDeviceInput(adb: Adb | null) {
  const tap = (x: number, y: number): Promise<void> => {
    if (!adb) return Promise.resolve();
    return input(adb, ["tap", String(Math.round(x)), String(Math.round(y))]);
  };

  const swipe = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs = 150,
  ): Promise<void> => {
    if (!adb) return Promise.resolve();
    return input(adb, [
      "swipe",
      String(Math.round(x1)),
      String(Math.round(y1)),
      String(Math.round(x2)),
      String(Math.round(y2)),
      String(Math.round(durationMs)),
    ]);
  };

  const keyEvent = (code: number): Promise<void> => {
    if (!adb) return Promise.resolve();
    return input(adb, ["keyevent", String(Math.round(code))]);
  };

  // A single character, not a whole string at a time — see ScreenView's onKeyDown, which calls
  // this once per keystroke. Needs escapeArg (unlike the numeric-only calls above) since it's
  // arbitrary user-typed text, which can contain quotes/spaces/backslashes.
  const typeText = (char: string): Promise<void> => {
    if (!adb) return Promise.resolve();
    return input(adb, ["text", escapeArg(char)]);
  };

  // `input text` types via the on-device virtual keyboard's character map — real ASCII-ish
  // printable characters only, no Unicode/emoji, and no Enter (there's no `KeyEvent` for it via
  // text injection), which is a limitation of the Android command itself, not something fixable
  // from here without a helper app. Newlines are flattened to spaces rather than sent through
  // raw, both because Enter can't be represented anyway and to keep the one command line this
  // sends simple and predictable regardless of what's on the clipboard.
  const pasteText = (text: string): Promise<void> => {
    if (!adb) return Promise.resolve();
    return input(adb, ["text", escapeArg(text.replace(/\r?\n/g, " "))]);
  };

  return { tap, swipe, keyEvent, typeText, pasteText };
}
