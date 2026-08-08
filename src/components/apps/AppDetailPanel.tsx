import { useState } from "react";
import type { Adb } from "@yume-chan/adb";
import { useAdbStore } from "../../state/useAdbStore";
import { useFileBrowserStore } from "../../state/useFileBrowserStore";
import { useDockStore } from "../../state/useDockStore";
import { useAppsStore } from "../../state/useAppsStore";
import { isDangerousPermission } from "../../lib/adb/dangerousPermissions";
import {
  buildLaunchActivityArgs,
  buildSendBroadcastArgs,
  buildStartServiceArgs,
  identityTestsReachability,
  interpretLaunchOutput,
  launchActivity,
  sendBroadcast,
  startService,
  type IntentExtra,
  type LaunchIdentity,
} from "../../lib/adb/quickLaunch";
import { startMirror } from "../screen/useScreenMirror";
import { attemptBackup, looksLikeValidBackup } from "../../lib/adb/backupAttempt";
import { parseAndroidBackup } from "../../lib/androidBackup/parseBackup";
import { buildVirtualFs } from "../../lib/androidBackup/virtualFs";
import { downloadBlob } from "../../lib/downloadBlob";
import type { PackageEntry } from "./parsePackageList";
import type { PackageComponents } from "../../lib/adb/dumpsysPackage";
import { ProviderExplorer } from "./ProviderExplorer";
import { DeepLinkGroup } from "./DeepLinkGroup";
import { IntentExtrasEditor } from "./IntentExtrasEditor";
import { DetectedExtrasPanel } from "./DetectedExtrasPanel";
import { useExtraKeyScan } from "./useExtraKeyScan";
import { CommandPreview, useIdentitySelector, LaunchResultBadge } from "./LaunchIdentityControls";

type ComponentMode = "activity" | "service" | "receiver";

const MODE_LABELS: Record<ComponentMode, string> = {
  activity: "Launch & Watch",
  service: "Start & Watch",
  receiver: "Send & Watch",
};

function runForMode(
  adb: Adb,
  mode: ComponentMode,
  component: string,
  extras: IntentExtra[],
  identity: LaunchIdentity,
): Promise<string> {
  switch (mode) {
    case "activity":
      return launchActivity(adb, component, extras, identity);
    case "service":
      return startService(adb, component, extras, identity);
    case "receiver":
      return sendBroadcast(adb, component, extras, identity);
  }
}

function buildArgsForMode(mode: ComponentMode, component: string, extras: IntentExtra[]): string[] {
  switch (mode) {
    case "activity":
      return buildLaunchActivityArgs(component, extras);
    case "service":
      return buildStartServiceArgs(component, extras);
    case "receiver":
      return buildSendBroadcastArgs(component, extras);
  }
}

/** Fires the given action and opens the screen dock so the result is visible without leaving
 * the Apps tab — shared by every "quick launch" affordance on this page. Only records a
 * reachability finding for the component when `identity` is one that actually tests it (shell or
 * a specific UID) — a root or "app itself" launch always trivially succeeds and would otherwise
 * paint every component as falsely "confirmed reachable". */
function launchAndWatch(adb: Adb, component: string, identity: LaunchIdentity, run: () => Promise<string>) {
  useDockStore.getState().setOpen(true);
  startMirror(adb);
  void run().then((raw) => {
    if (identityTestsReachability(identity)) {
      useAppsStore.getState().setLaunchResult(component, interpretLaunchOutput(raw));
    }
  });
}

/** Points the Files tab at a debuggable app's private data via `run-as` (no root needed) and
 * switches to it — turns the "debuggable" finding into something you can actually act on. */
function browsePrivateData(pkg: string) {
  const fileStore = useFileBrowserStore.getState();
  fileStore.setRunAsPackage(pkg);
  fileStore.setCurrentPath(`/data/data/${pkg}`);
  fileStore.setViewMode("list");
  useAdbStore.getState().setActiveView("files");
}

/** Same jump-to-Files-tab pattern as `browsePrivateData`, but for a parsed backup archive's
 * contents (an in-memory virtual filesystem) instead of a live `run-as` path — turns "got a
 * backup" into something actually browsable with the Files tab's existing list/preview/download
 * UI rather than a cramped one-off list here. */
function browseBackupContents(pkg: string, raw: Uint8Array): void {
  const { entries } = parseAndroidBackup(raw);
  const fileStore = useFileBrowserStore.getState();
  fileStore.setVirtualSource(buildVirtualFs(entries), pkg);
  fileStore.setCurrentPath("/");
  fileStore.setViewMode("list");
  useAdbStore.getState().setActiveView("files");
}

// Broadcasts/services in particular often branch entirely on their extras rather than the
// component name alone — the editor is collapsed by default since most launches don't need it.
function ComponentRow({
  pkg,
  component,
  mode,
  adb,
}: {
  pkg: string;
  component: string;
  mode: ComponentMode | null;
  adb: Adb | null;
}) {
  const [showExtras, setShowExtras] = useState(false);
  const [extras, setExtras] = useState<IntentExtra[]>([]);
  const { cache: detectedCache, scanningComponent, error: detectError, scan } = useExtraKeyScan(adb);
  const detected = detectedCache.get(component);
  const detecting = scanningComponent === component;
  const { identity, ready: identityReady, control: identityControl } = useIdentitySelector(pkg);

  const addDetectedExtra = (extra: IntentExtra) => {
    setExtras((prev) => [...prev, extra]);
    setShowExtras(true);
  };

  return (
    <div className="space-y-1 pl-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-neutral-400">{component}</span>
        <LaunchResultBadge component={component} />
        {mode && (
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <button
              type="button"
              disabled={!adb || detecting}
              onClick={() => adb && void scan(pkg, component)}
              title="Best-effort scan of this component's own code for Intent/Bundle extras"
              className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 disabled:opacity-50"
            >
              {detecting ? "Scanning…" : "Detect extras"}
            </button>
            <button
              type="button"
              onClick={() => setShowExtras((v) => !v)}
              className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800"
            >
              {showExtras ? "Hide extras" : "Extras"}
            </button>
            {identityControl}
            <button
              type="button"
              disabled={!adb || !identityReady}
              onClick={() =>
                adb &&
                launchAndWatch(adb, component, identity, () =>
                  runForMode(adb, mode, component, extras, identity),
                )
              }
              className="rounded border border-emerald-800 px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-950 disabled:opacity-50"
            >
              {MODE_LABELS[mode]}
            </button>
          </div>
        )}
      </div>
      {detectError && detected === undefined && (
        <p className="pl-2 text-neutral-600">{detectError}</p>
      )}
      {detected && <DetectedExtrasPanel results={detected} onAddToExtras={addDetectedExtra} />}
      {showExtras && mode && (
        <>
          <IntentExtrasEditor extras={extras} onChange={setExtras} />
          <CommandPreview args={buildArgsForMode(mode, component, extras)} identity={identity} />
        </>
      )}
    </div>
  );
}

function ComponentGroup({
  pkg,
  title,
  components,
  mode,
  adb,
}: {
  pkg: string;
  title: string;
  components: string[];
  mode: ComponentMode | null;
  adb: Adb | null;
}) {
  if (components.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-neutral-500">
        {title} ({components.length})
      </div>
      {components.map((component) => (
        <ComponentRow key={component} pkg={pkg} component={component} mode={mode} adb={adb} />
      ))}
    </div>
  );
}

function Flag({ label, active, activeIsFinding }: { label: string; active: boolean; activeIsFinding: boolean }) {
  const flagged = active && activeIsFinding;
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-xs ${
        flagged
          ? "border-amber-800 bg-amber-950/40 text-amber-300"
          : "border-neutral-800 text-neutral-500"
      }`}
    >
      {label}: {active ? "yes" : "no"}
    </span>
  );
}

type Severity = "high" | "medium" | "info";

const SEVERITY_BORDER: Record<Severity, string> = {
  high: "border-red-900 bg-red-950/30",
  medium: "border-amber-800 bg-amber-950/30",
  info: "border-neutral-800 bg-neutral-900/40",
};

const SEVERITY_TEXT: Record<Severity, string> = {
  high: "text-red-300",
  medium: "text-amber-300",
  info: "text-neutral-400",
};

function FindingCard({
  severity,
  title,
  description,
  actionLabel,
  onAction,
}: {
  severity: Severity;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`rounded border px-2.5 py-2 text-xs ${SEVERITY_BORDER[severity]}`}>
      <div className={`font-semibold ${SEVERITY_TEXT[severity]}`}>{title}</div>
      <p className="mt-0.5 text-neutral-500">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-1.5 rounded border border-emerald-800 px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-950"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

type BackupState =
  | { phase: "idle" }
  | { phase: "running"; bytes: number; cancel: () => void }
  | { phase: "done"; raw: Uint8Array; valid: boolean }
  | { phase: "error"; message: string };

/** Turns the `allowBackup=true` finding into a real attempt rather than just a flag — see
 * `attemptBackup`'s doc comment for why an empty/headerless result is an expected outcome, not an
 * error, on modern Android. */
function BackupFindingCard({ pkg, adb }: { pkg: string; adb: Adb | null }) {
  const [state, setState] = useState<BackupState>({ phase: "idle" });
  const [browseError, setBrowseError] = useState<string | null>(null);

  const run = () => {
    if (!adb) return;
    setBrowseError(null);
    // `bu backup` sometimes needs an on-device confirmation dialog tapped before it'll stream
    // anything — opening the mirror makes that visible instead of leaving the attempt looking
    // hung with no explanation.
    useDockStore.getState().setOpen(true);
    startMirror(adb);
    const attempt = attemptBackup(adb, pkg, (bytes) =>
      setState((s) => (s.phase === "running" ? { ...s, bytes } : s)),
    );
    setState({ phase: "running", bytes: 0, cancel: attempt.cancel });
    attempt.result
      .then((raw) => {
        const valid = looksLikeValidBackup(raw);
        setState({ phase: "done", raw, valid });
        if (valid) downloadBlob(new Blob([raw as BlobPart]), `${pkg}.ab`);
      })
      .catch((err: unknown) => {
        setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      });
  };

  const browse = () => {
    if (state.phase !== "done") return;
    try {
      browseBackupContents(pkg, state.raw);
      setBrowseError(null);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="rounded border border-amber-800 bg-amber-950/30 px-2.5 py-2 text-xs">
      <div className="font-semibold text-amber-300">Backup allowed (allowBackup=true)</div>
      <p className="mt-0.5 text-neutral-500">
        Most apps targeting API 29+ block adb-based backup outright, or the stream comes back
        empty — this tries anyway rather than assuming, and only offers a download if the result
        actually looks like a valid backup archive. Some devices show an on-device confirmation
        dialog that blocks until a human taps it; Cancel gives up waiting instead of hanging.
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {state.phase !== "running" && (
          <button
            type="button"
            disabled={!adb}
            onClick={run}
            className="rounded border border-emerald-800 px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-950 disabled:opacity-50"
          >
            {state.phase === "idle" ? "Attempt Backup" : "Retry Backup"}
          </button>
        )}
        {state.phase === "running" && (
          <>
            <span className="text-neutral-500">Receiving… {state.bytes.toLocaleString()} bytes</span>
            <button
              type="button"
              onClick={state.cancel}
              className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800"
            >
              Cancel
            </button>
          </>
        )}
        {state.phase === "done" && (
          <span className={state.valid ? "text-emerald-300" : "text-neutral-500"}>
            {state.valid
              ? `Got a valid backup archive (${state.raw.length.toLocaleString()} bytes) — download started.`
              : `Received ${state.raw.length.toLocaleString()} byte${state.raw.length === 1 ? "" : "s"} with no valid backup header — backup is effectively blocked for this app.`}
          </span>
        )}
        {state.phase === "done" && state.valid && (
          <button
            type="button"
            onClick={browse}
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800"
          >
            Browse in Files tab
          </button>
        )}
        {state.phase === "error" && <span className="text-red-300">{state.message}</span>}
      </div>
      {browseError && <p className="mt-1.5 text-neutral-600">{browseError}</p>}
    </div>
  );
}

export interface AppDetailPanelProps {
  pkg: PackageEntry;
  adb: Adb | null;
  busy: boolean;
  scanning: boolean;
  components: PackageComponents | undefined;
  onClose: () => void;
  onForceStop: () => void;
  onClearData: () => void;
  onPullApk: () => void;
  onUninstall: () => void;
  onRunScan: () => void;
  onRescan: () => void;
}

export function AppDetailPanel({
  pkg,
  adb,
  busy,
  scanning,
  components,
  onClose,
  onForceStop,
  onClearData,
  onPullApk,
  onUninstall,
  onRunScan,
  onRescan,
}: AppDetailPanelProps) {
  const dangerousCount = components ? components.permissions.filter(isDangerousPermission).length : 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-neutral-100">{pkg.packageName}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={onForceStop}
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            Force Stop
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClearData}
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            Clear Data
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onPullApk}
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
          >
            Pull APK
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onUninstall}
            className="rounded border border-red-900 px-1.5 py-0.5 text-xs text-red-300 hover:bg-red-950 disabled:opacity-50"
          >
            Uninstall
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-neutral-500 hover:text-neutral-200"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {scanning ? (
          <p className="text-xs text-neutral-600">Scanning…</p>
        ) : !components ? (
          <button
            type="button"
            onClick={onRunScan}
            className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400"
          >
            Run Scan
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-neutral-600">
                Best-effort, scraped from <code>dumpsys package</code> — reachability (exported
                status, deep link matching) isn't reliably determinable from this text across
                Android versions, so everything found is listed; a failed launch usually just
                means it wasn't reachable.
              </p>
              <button
                type="button"
                onClick={onRescan}
                className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
              >
                Re-scan
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Flag label="Debuggable" active={components.debuggable} activeIsFinding />
              <Flag label="Allow Backup" active={components.allowBackup} activeIsFinding />
              {components.versionName && (
                <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-xs text-neutral-500">
                  v{components.versionName}
                  {components.versionCode ? ` (${components.versionCode})` : ""}
                </span>
              )}
              {components.targetSdk && (
                <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-xs text-neutral-500">
                  targetSdk {components.targetSdk}
                </span>
              )}
            </div>

            {(components.debuggable || components.allowBackup || dangerousCount > 0) && (
              <div className="space-y-1.5">
                {components.debuggable && (
                  <FindingCard
                    severity="high"
                    title="App is debuggable"
                    description="Its private /data/data storage is readable without root via run-as — shared_prefs, databases, and cache files are all in reach."
                    actionLabel="Browse private data"
                    onAction={() => browsePrivateData(pkg.packageName)}
                  />
                )}
                {components.allowBackup && <BackupFindingCard pkg={pkg.packageName} adb={adb} />}
                {dangerousCount > 0 && (
                  <FindingCard
                    severity="medium"
                    title={`${dangerousCount} dangerous permission${dangerousCount === 1 ? "" : "s"} requested`}
                    description="See the highlighted permissions below."
                  />
                )}
              </div>
            )}

            <ComponentGroup
              pkg={pkg.packageName}
              title="Activities"
              components={components.activities}
              mode="activity"
              adb={adb}
            />
            <ComponentGroup
              pkg={pkg.packageName}
              title="Services"
              components={components.services}
              mode="service"
              adb={adb}
            />
            <ComponentGroup
              pkg={pkg.packageName}
              title="Receivers"
              components={components.receivers}
              mode="receiver"
              adb={adb}
            />
            <ComponentGroup
              pkg={pkg.packageName}
              title="Providers"
              components={components.providers}
              mode={null}
              adb={adb}
            />
            <DeepLinkGroup deepLinks={components.deepLinks} adb={adb} />

            {components.permissions.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-neutral-500">
                  Requested permissions ({components.permissions.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {components.permissions.map((permission) => {
                    const dangerous = isDangerousPermission(permission);
                    // Only dangerous (runtime) permissions have a meaningful grant/deny state at
                    // all — normal/install-time permissions are always granted and never show up
                    // in the "runtime permissions" section this is scraped from, so `granted` is
                    // `undefined` for them by design, not a scraping gap.
                    const granted = components.permissionGrants[permission];
                    return (
                      <span
                        key={permission}
                        title={
                          !dangerous
                            ? undefined
                            : granted === undefined
                              ? "Sensitive permission — grant status unknown"
                              : granted
                                ? "Sensitive permission — granted at runtime"
                                : "Sensitive permission — requested but not granted"
                        }
                        className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                          dangerous && granted
                            ? "bg-red-950/50 text-red-300"
                            : dangerous
                              ? "bg-amber-950/40 text-amber-300"
                              : "bg-neutral-900 text-neutral-500"
                        }`}
                      >
                        {permission}
                        {dangerous && granted !== undefined && (
                          <span className={granted ? "text-red-300" : "text-neutral-500"}>
                            {" "}
                            · {granted ? "granted" : "not granted"}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <ProviderExplorer adb={adb} suggestedAuthorities={components.providerAuthorities} />
          </div>
        )}
      </div>
    </div>
  );
}
