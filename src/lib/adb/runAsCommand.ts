import { escapeArg } from "@yume-chan/adb";

/**
 * Wraps an argv array so it runs as a debuggable app's own UID via `run-as <pkg>`, giving access
 * to that app's private `/data/data/<pkg>` without root. Unlike `suCommand` (see `suCommand.ts`),
 * `run-as` execs the given command directly rather than handing it to an embedded sub-shell, so
 * each argument only needs one layer of escaping, not `su -c`'s double-escape.
 */
export function runAsCommand(pkg: string, args: readonly string[]): string[] {
  return ["run-as", escapeArg(pkg), ...args.map(escapeArg)];
}

/**
 * Like `runAsCommand`, but for a pre-built shell snippet (e.g. `a && b`) rather than a single
 * command's argv — the caller is responsible for `escapeArg`-ing each dynamic piece of `snippet`
 * themselves, since this only wraps the snippet as a whole for the inner `sh -c`.
 */
export function runAsShellCommand(pkg: string, snippet: string): string[] {
  return ["run-as", escapeArg(pkg), "sh", "-c", escapeArg(snippet)];
}
