import { escapeArg, type Adb } from "@yume-chan/adb";
import { suAsUidCommand, suCommand } from "./suCommand";
import { runAsCommand } from "./runAsCommand";

/**
 * Fire-and-forget component/deep-link launches for the Apps tab's scan findings — deliberately
 * narrow (no full extras/flags builder UI, just the common `am` extra types) since these are
 * one-click "try this" actions, not a general-purpose intent builder.
 */

export type IntentExtraType = "string" | "boolean" | "int" | "long";

export interface IntentExtra {
  type: IntentExtraType;
  key: string;
  value: string;
}

// Standard `am` CLI flags for typed extras — many deep links and broadcast/service intents don't
// just read data out of the URI, they expect specific `Intent.putExtra()` values to be set too.
const EXTRA_FLAG: Record<IntentExtraType, string> = {
  string: "--es",
  boolean: "--ez",
  int: "--ei",
  long: "--el",
};

function extrasToArgs(extras: IntentExtra[]): string[] {
  const args: string[] = [];
  for (const extra of extras) {
    if (!extra.key) continue;
    args.push(EXTRA_FLAG[extra.type], escapeArg(extra.key), escapeArg(extra.value));
  }
  return args;
}

// Exported (not just used internally) so the UI can render a live "this is the exact command
// that will run" preview from the *same* argv-building logic that actually executes — a static
// description of what a launch does can drift from reality, but this can't, since it's not a
// second copy.
export function buildLaunchActivityArgs(component: string, extras: IntentExtra[]): string[] {
  return ["am", "start", "-n", escapeArg(component), ...extrasToArgs(extras)];
}

export function buildStartServiceArgs(component: string, extras: IntentExtra[]): string[] {
  return ["am", "startservice", "-n", escapeArg(component), ...extrasToArgs(extras)];
}

export function buildSendBroadcastArgs(component: string, extras: IntentExtra[]): string[] {
  return ["am", "broadcast", "-n", escapeArg(component), ...extrasToArgs(extras)];
}

// `-n <component>` targets the exact activity the scan already found, *in addition to* `-a`/`-d`
// — without it, this relies entirely on Android's implicit intent-filter resolution matching the
// URI, which breaks the moment the (deliberately editable) URI field is edited into something
// that no longer lines up exactly with the manifest's registered scheme/host/path pattern: the
// launch silently fails to resolve to any app, or to the wrong one if several register the same
// scheme. Passing both is the standard, documented way to test a deep link reliably — the
// component receives the intent so its `onNewIntent`/`getIntent().getData()` handling can be
// exercised, but resolution no longer depends on the URI text matching anything.
export function buildLaunchDeepLinkArgs(uri: string, component: string, extras: IntentExtra[]): string[] {
  return [
    "am",
    "start",
    "-n",
    escapeArg(component),
    "-a",
    "android.intent.action.VIEW",
    "-d",
    escapeArg(uri),
    ...extrasToArgs(extras),
  ];
}

/**
 * Which identity a launch actually runs as — the real security question for an exported/
 * protected-component finding is "can *another app* reach this", not "can I, holding a root
 * shell, reach this" (root bypasses every check by design) or "can the app reach its own
 * component" (always trivially true). Only `shell` and `uid` produce a meaningful signal about
 * real cross-app reachability; `root`/`self` are offered for convenience (functional testing,
 * working around unrelated restrictions) but don't confirm or refute an export/permission finding.
 */
export type LaunchIdentity =
  | { kind: "shell" }
  | { kind: "root" }
  | { kind: "self"; pkg: string }
  | { kind: "uid"; uid: string };

/** Exported for the same reason as the `build*Args` functions above — an accurate command
 * preview needs the *actual* identity-wrapping logic, not a description of it. */
export function wrapForIdentity(args: string[], identity: LaunchIdentity): string[] {
  switch (identity.kind) {
    case "shell":
      return args;
    case "root":
      return suCommand(args);
    case "self":
      return runAsCommand(identity.pkg, args);
    case "uid":
      return suAsUidCommand(identity.uid, args);
  }
}

/** Whether a launch under this identity says anything meaningful about real exported/permission
 * enforcement (see `LaunchIdentity`'s doc comment) — used to decide whether to record/highlight
 * the result as a finding, versus just showing it as a one-off action outcome. */
export function identityTestsReachability(identity: LaunchIdentity): boolean {
  return identity.kind === "shell" || identity.kind === "uid";
}

async function runLaunch(adb: Adb, args: string[], identity: LaunchIdentity): Promise<string> {
  return adb.subprocess.noneProtocol.spawnWaitText(wrapForIdentity(args, identity));
}

const DEFAULT_IDENTITY: LaunchIdentity = { kind: "shell" };

export async function launchActivity(
  adb: Adb,
  component: string,
  extras: IntentExtra[] = [],
  identity: LaunchIdentity = DEFAULT_IDENTITY,
): Promise<string> {
  return runLaunch(adb, buildLaunchActivityArgs(component, extras), identity);
}

export async function startService(
  adb: Adb,
  component: string,
  extras: IntentExtra[] = [],
  identity: LaunchIdentity = DEFAULT_IDENTITY,
): Promise<string> {
  return runLaunch(adb, buildStartServiceArgs(component, extras), identity);
}

export async function sendBroadcast(
  adb: Adb,
  component: string,
  extras: IntentExtra[] = [],
  identity: LaunchIdentity = DEFAULT_IDENTITY,
): Promise<string> {
  return runLaunch(adb, buildSendBroadcastArgs(component, extras), identity);
}

export async function launchDeepLink(
  adb: Adb,
  uri: string,
  component: string,
  extras: IntentExtra[] = [],
  identity: LaunchIdentity = DEFAULT_IDENTITY,
): Promise<string> {
  return runLaunch(adb, buildLaunchDeepLinkArgs(uri, component, extras), identity);
}

export type LaunchOutcome = "started" | "not-exported" | "permission-denied" | "error" | "unknown";

export interface LaunchResult {
  outcome: LaunchOutcome;
  /** Set when a permission-denial names a specific permission that would allow the call —
   * distinct from a bare "not exported" denial, which no permission fixes. */
  requiredPermission: string | null;
  raw: string;
  at: number;
}

/**
 * Best-effort interpretation of `am`'s own text output — same scraping posture as everything
 * else in this app, since exact wording isn't a stable contract across Android versions. `am`
 * itself still exits 0 on a permission denial (the failure is only visible in the printed text),
 * which is why this has to parse output rather than rely on a spawn failure/exit code.
 */
export function interpretLaunchOutput(raw: string): LaunchResult {
  const at = Date.now();
  if (/SecurityException/.test(raw)) {
    const permMatch = /requires(?: an additional)? permission\s+([\w.]+)|requires\s+([\w.]+)/i.exec(raw);
    const requiredPermission = permMatch ? (permMatch[1] ?? permMatch[2]) : null;
    if (requiredPermission) {
      return { outcome: "permission-denied", requiredPermission, raw, at };
    }
    if (/not exported/i.test(raw)) {
      return { outcome: "not-exported", requiredPermission: null, raw, at };
    }
    return { outcome: "permission-denied", requiredPermission: null, raw, at };
  }
  if (/(?:^|\n)\s*Error:|Exception/i.test(raw)) {
    return { outcome: "error", requiredPermission: null, raw, at };
  }
  if (raw.trim() === "" || /^(Starting:|Broadcasting:)/im.test(raw)) {
    return { outcome: "started", requiredPermission: null, raw, at };
  }
  return { outcome: "unknown", requiredPermission: null, raw, at };
}
