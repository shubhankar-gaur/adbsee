import { useState, type ReactNode } from "react";
import { wrapForIdentity, type LaunchIdentity, type LaunchOutcome } from "../../lib/adb/quickLaunch";
import { useAppsStore } from "../../state/useAppsStore";

type PresetKind = "shell" | "root" | "self" | "uid";

const PRESET_LABELS: Record<PresetKind, string> = {
  shell: "Shell",
  root: "Root (su)",
  self: "App itself (run-as)",
  uid: "Custom UID (su)",
};

/**
 * Identity picker for a single launch action. Only "Shell" and "Custom UID" say anything about
 * real cross-app reachability — Root bypasses every check by design, and "App itself" always
 * trivially succeeds against the app's own components — so those two are offered for convenience
 * (functional testing) but their results are never persisted as a reachability finding, see
 * `identityTestsReachability` in `quickLaunch.ts` and how callers use it below.
 */
export function useIdentitySelector(pkg: string): {
  identity: LaunchIdentity;
  ready: boolean;
  control: ReactNode;
} {
  const [kind, setKind] = useState<PresetKind>("shell");
  const [uid, setUid] = useState("");

  const identity: LaunchIdentity =
    kind === "shell"
      ? { kind: "shell" }
      : kind === "root"
        ? { kind: "root" }
        : kind === "self"
          ? { kind: "self", pkg }
          : { kind: "uid", uid: uid.trim() };

  const ready = kind !== "uid" || uid.trim() !== "";

  const control = (
    <div className="flex shrink-0 items-center gap-1">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as PresetKind)}
        title="Identity to launch as — Shell and Custom UID are the only ones that say anything about real cross-app reachability; Root and the app's own identity bypass or trivially satisfy every check."
        className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-neutral-400"
      >
        {(Object.keys(PRESET_LABELS) as PresetKind[]).map((k) => (
          <option key={k} value={k}>
            {PRESET_LABELS[k]}
          </option>
        ))}
      </select>
      {kind === "uid" && (
        <input
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          placeholder="uid"
          className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 font-mono text-neutral-200"
        />
      )}
    </div>
  );

  return { identity, ready, control };
}

/**
 * Shows the *exact* command a launch button will run, built from the same argv/identity-wrapping
 * functions that actually execute it — not a separate description that could drift from reality.
 * Exists because extras and URI query parameters look similar but are completely different
 * mechanisms (`--es key value` vs. data baked into the `-d` URI itself), and there was previously
 * no way to tell, before clicking launch, which one an edit actually landed in.
 */
export function CommandPreview({ args, identity }: { args: string[]; identity: LaunchIdentity }) {
  const full = wrapForIdentity(args, identity).join(" ");
  return (
    <p className="overflow-x-auto whitespace-pre rounded bg-neutral-950 px-2 py-1 font-mono text-neutral-500">
      $ {full}
    </p>
  );
}

const OUTCOME_STYLE: Record<LaunchOutcome, string> = {
  started: "border-emerald-800 text-emerald-300",
  "not-exported": "border-neutral-700 text-neutral-500",
  "permission-denied": "border-amber-800 text-amber-300",
  error: "border-red-900 text-red-300",
  unknown: "border-neutral-700 text-neutral-500",
};

const OUTCOME_LABEL: Record<LaunchOutcome, string> = {
  started: "reachable",
  "not-exported": "not exported (confirmed)",
  "permission-denied": "permission required",
  error: "error",
  unknown: "unknown",
};

/** Shows the most recent *reachability-test* (shell/uid identity) launch result for a component —
 * see `useIdentitySelector`'s doc comment for why root/self results never reach the store this
 * reads from. */
export function LaunchResultBadge({ component }: { component: string }) {
  const result = useAppsStore((s) => s.launchResultsByComponent.get(component));
  if (!result) return null;
  const title = result.requiredPermission
    ? `Requires permission: ${result.requiredPermission}`
    : result.raw.trim().slice(0, 300) || undefined;
  return (
    <span
      title={title}
      className={`shrink-0 rounded border px-1.5 py-0.5 text-xs ${OUTCOME_STYLE[result.outcome]}`}
    >
      {OUTCOME_LABEL[result.outcome]}
      {result.requiredPermission ? `: ${result.requiredPermission}` : ""}
    </span>
  );
}
