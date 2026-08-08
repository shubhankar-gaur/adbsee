import { useState } from "react";
import type { Adb } from "@yume-chan/adb";
import { useDockStore } from "../../state/useDockStore";
import { useAppsStore } from "../../state/useAppsStore";
import { startMirror } from "../screen/useScreenMirror";
import {
  buildLaunchDeepLinkArgs,
  identityTestsReachability,
  interpretLaunchOutput,
  launchDeepLink,
  type IntentExtra,
  type LaunchIdentity,
} from "../../lib/adb/quickLaunch";
import type { DeepLinkFilter } from "../../lib/adb/parseDumpsysDeepLinks";
import { IntentExtrasEditor } from "./IntentExtrasEditor";
import { CommandPreview, useIdentitySelector, LaunchResultBadge } from "./LaunchIdentityControls";

function buildUri(link: DeepLinkFilter): string {
  const authority = link.host ?? "";
  if (!link.path) return `${link.scheme}://${authority}`;
  const path = link.path.startsWith("/") ? link.path : `/${link.path}`;
  return `${link.scheme}://${authority}${path}`;
}

/** Fires the deep link and opens the screen dock so the result is visible without leaving the
 * Apps tab — same pattern (and same root/self exclusion) as launching an activity/service/
 * receiver, see `AppDetailPanel.tsx`'s `launchAndWatch`. */
function launchAndWatch(
  adb: Adb,
  component: string,
  uri: string,
  extras: IntentExtra[],
  identity: LaunchIdentity,
) {
  useDockStore.getState().setOpen(true);
  startMirror(adb);
  void launchDeepLink(adb, uri, component, extras, identity).then((raw) => {
    if (identityTestsReachability(identity)) {
      useAppsStore.getState().setLaunchResult(component, interpretLaunchOutput(raw));
    }
  });
}

// A manifest-declared filter only pins down scheme/host/path — it says nothing about query
// parameters or intent extras (tokens, IDs) many deep links actually need to do anything useful,
// and a PathPattern is a matching pattern (wildcards), not a literal launchable path. Both the
// URI and the extras are editable so the guessed starting point can be filled in before firing.
function DeepLinkRow({ link, adb }: { link: DeepLinkFilter; adb: Adb | null }) {
  const [uri, setUri] = useState(() => buildUri(link));
  const [showExtras, setShowExtras] = useState(false);
  const [extras, setExtras] = useState<IntentExtra[]>([]);
  const pkg = link.component.split("/")[0];
  const { identity, ready: identityReady, control: identityControl } = useIdentitySelector(pkg);

  return (
    <div className="space-y-1 pl-2 text-xs">
      <div className="flex items-center justify-between gap-2 text-neutral-600">
        <span className="truncate">{link.component}</span>
        <div className="flex shrink-0 items-center gap-2">
          {link.pathIsPattern && (
            <span className="text-amber-300" title={`Pattern from the manifest: ${link.path}`}>
              path is a pattern — edit before launching
            </span>
          )}
          <LaunchResultBadge component={link.component} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 font-mono text-neutral-200"
        />
        <button
          type="button"
          onClick={() => setShowExtras((v) => !v)}
          className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800"
        >
          {showExtras ? "Hide extras" : "Extras"}
        </button>
        {identityControl}
        <button
          type="button"
          disabled={!adb || !identityReady}
          onClick={() => adb && launchAndWatch(adb, link.component, uri, extras, identity)}
          className="shrink-0 rounded border border-emerald-800 px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-950 disabled:opacity-50"
        >
          Launch &amp; Watch
        </button>
      </div>
      {showExtras && <IntentExtrasEditor extras={extras} onChange={setExtras} />}
      <CommandPreview args={buildLaunchDeepLinkArgs(uri, link.component, extras)} identity={identity} />
    </div>
  );
}

export function DeepLinkGroup({ deepLinks, adb }: { deepLinks: DeepLinkFilter[]; adb: Adb | null }) {
  if (deepLinks.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-neutral-500">Deep Links ({deepLinks.length})</div>
      <p className="text-xs text-neutral-600">
        Best-effort URIs from the manifest — edit to add query parameters or fix a pattern-based
        path, and use "Extras" for intents that expect specific `Intent.putExtra()` values rather
        than (or in addition to) URI data; the manifest can't tell us what a given link expects.
        Launches always target this exact component directly, so editing the URI can't cause it to
        resolve to the wrong app (or nothing at all) the way relying on implicit intent-filter
        matching would.
      </p>
      {deepLinks.map((link) => (
        <DeepLinkRow
          key={`${link.component}|${link.scheme}|${link.host ?? ""}|${link.path ?? ""}`}
          link={link}
          adb={adb}
        />
      ))}
    </div>
  );
}
