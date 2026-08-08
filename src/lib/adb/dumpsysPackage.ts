import { extractComponents, extractFirstMatch, extractSection } from "./dumpsysScrape";
import { parseDumpsysDeepLinks, type DeepLinkFilter } from "./parseDumpsysDeepLinks";

export interface PackageComponents {
  activities: string[];
  services: string[];
  receivers: string[];
  providers: string[];
  providerAuthorities: string[];
  permissions: string[];
  /** Whether each *requested* dangerous permission is actually granted at runtime — a permission
   * can be declared without ever being granted (denied by the user, or not yet requested by the
   * app), which is a materially different finding than "requested". Missing key = unknown
   * (couldn't find a grant line for it, not "known ungranted"). */
  permissionGrants: Record<string, boolean>;
  deepLinks: DeepLinkFilter[];
  debuggable: boolean;
  allowBackup: boolean;
  versionName: string | null;
  versionCode: string | null;
  targetSdk: string | null;
}

function extractPermissions(section: string): string[] {
  const pattern = /[\w.]+\.permission\.[\w.]+/g;
  const found = new Set<string>();
  for (const match of section.matchAll(pattern)) found.add(match[0]);
  return [...found].sort();
}

/**
 * Provider authorities live in a completely different part of `dumpsys package` than the
 * per-package `providers:` component list (which only ever prints bare component names, no
 * attributes) — the real location is a separate `Registered ContentProviders:` section, with each
 * provider's authorities printed as a bracketed, `;`/`,`-separated list on a
 * `ContentProvider Authorities: [...]` line. Scans the whole output (not just one section) and
 * also keeps the older `authority="..."` attribute-style match as a supplementary net, in case
 * some Android version/OEM prints it inline instead — best-effort, same as everything else
 * scraped from this format.
 */
function extractAuthorities(output: string): string[] {
  const found = new Set<string>();

  for (const match of output.matchAll(/ContentProvider Authorities:\s*\[([^\]]*)\]/g)) {
    for (const authority of match[1].split(/[,;]\s*/)) {
      if (authority) found.add(authority.trim());
    }
  }
  for (const match of output.matchAll(/authorit(?:y|ies)=(?:"([^"]+)"|(\S+))/g)) {
    const value = match[1] ?? match[2];
    for (const authority of value.split(";")) {
      if (authority) found.add(authority);
    }
  }

  return [...found].sort();
}

/**
 * Grant status lives in a "runtime permissions:" section, separate from "requested permissions:"
 * (which just lists everything declared, regardless of whether it was ever granted) — format
 * confirmed as `<permission>: granted=<true|false>, flags=[...]` per line. Falls back to scanning
 * the whole output if that section header isn't found on this Android version, same best-effort
 * posture as everything else scraped from this format.
 */
function extractPermissionGrants(output: string): Record<string, boolean> {
  const section = extractSection(output, /^\s*runtime permissions:\s*$/m);
  const searchSpace = section || output;
  const grants: Record<string, boolean> = {};
  for (const match of searchSpace.matchAll(/([\w.]+):\s*granted=(true|false)/g)) {
    grants[match[1]] = match[2] === "true";
  }
  return grants;
}

export function parseDumpsysPackage(output: string, pkg: string): PackageComponents {
  const providerSection = extractSection(output, /^\s*providers:\s*$/m);
  const flagsMatch = /flags=\[\s*([^\]]*)\]/.exec(output);
  const flags = flagsMatch ? flagsMatch[1].split(/\s+/) : [];

  return {
    activities: extractComponents(extractSection(output, /^\s*activities:\s*$/m), pkg),
    services: extractComponents(extractSection(output, /^\s*services:\s*$/m), pkg),
    receivers: extractComponents(extractSection(output, /^\s*receivers:\s*$/m), pkg),
    providers: extractComponents(providerSection, pkg),
    providerAuthorities: extractAuthorities(output),
    permissions: extractPermissions(extractSection(output, /^\s*requested permissions:\s*$/m)),
    permissionGrants: extractPermissionGrants(output),
    deepLinks: parseDumpsysDeepLinks(output, pkg),
    debuggable: flags.includes("DEBUGGABLE"),
    allowBackup: flags.includes("ALLOW_BACKUP"),
    versionName: extractFirstMatch(output, /versionName=(\S+)/),
    versionCode: extractFirstMatch(output, /versionCode=(\S+)/),
    targetSdk: extractFirstMatch(output, /targetSdk=(\S+)/),
  };
}
