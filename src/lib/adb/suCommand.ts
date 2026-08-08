import { escapeArg } from "@yume-chan/adb";

/**
 * Wraps an argv array so it runs as root via `su -c`, instead of as adbd's own (usually
 * unprivileged `shell`) user. `su -c` takes a single command string, which itself gets
 * re-parsed by the shell su spawns — so each inner argument is escaped once for that inner
 * shell, then the whole joined string is escaped again as the one argument `su -c` receives.
 */
export function suCommand(args: readonly string[]): string[] {
  const inner = args.map(escapeArg).join(" ");
  return ["su", "-c", escapeArg(inner)];
}

/**
 * Like `suCommand`, but for a pre-built shell snippet (e.g. `a && b`) rather than a single
 * command's argv — the caller is responsible for `escapeArg`-ing each dynamic piece of `snippet`
 * themselves, since this only wraps the snippet as a whole for `su -c`.
 */
export function suShellCommand(snippet: string): string[] {
  return ["su", "-c", escapeArg(snippet)];
}

/**
 * Runs as a *specific* UID rather than root itself — standard `su <uid> -c` behavior supported by
 * Magisk/toybox su (root can set-uid to anything, not just become uid 0). Used to test whether a
 * non-exported component is actually reachable from another app's identity, not just from the
 * shell — the real threat model for an exported-component finding, which testing as root or as
 * the target app's own uid (always trivially succeeds either way) doesn't exercise.
 */
export function suAsUidCommand(uid: string, args: readonly string[]): string[] {
  const inner = args.map(escapeArg).join(" ");
  return ["su", escapeArg(uid), "-c", escapeArg(inner)];
}
