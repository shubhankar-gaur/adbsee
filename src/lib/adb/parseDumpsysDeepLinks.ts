import { extractSection } from "./dumpsysScrape";

export interface DeepLinkFilter {
  component: string;
  scheme: string;
  host: string | null;
  /** Concrete path from `Path:`/`PathPrefix:`, or the raw pattern text from `PathPattern:` (which
   * contains regex-style wildcards, not a directly-launchable path) — see `pathIsPattern`. */
  path: string | null;
  /** True when `path` came from `PathPattern:` — it's a matching pattern (e.g. `.*` or
   * `/item/\d+`), not a literal path, so it needs editing before it'll actually launch anything. */
  pathIsPattern: boolean;
}

// Matches a resolver-table filter header line, e.g. `7f8a1b2 com.example/.DeepLinkActivity
// filter 9a3c4d5` — the same `<pkg>/<Component>` shape `extractComponents` looks for, but this
// also needs the surrounding block (the `Scheme:`/`Authority:`/`Path...:` lines that follow)
// rather than just the component name, so it can't reuse that helper directly.
const FILTER_HEADER = /^\s*[0-9a-f]+\s+([\w.]+\/[\w.$]+)\s+filter\s+[0-9a-f]+\s*$/gm;

/**
 * Best-effort scrape of `dumpsys package <pkg>`'s "Schemes:" resolver-table section for
 * app-declared deep links (custom URL schemes / `android.intent.action.VIEW` filters). Like
 * every other dumpsys scrape in this app, exact formatting can drift across Android versions —
 * a missing result here means "not found in this text," not "definitely doesn't exist."
 *
 * Path matters here, not just scheme/host: Android's intent-filter matching requires the path to
 * satisfy `Path:`/`PathPrefix:`/`PathPattern:` when the filter declares one — a bare
 * `scheme://host` URI silently fails to match (and so fails to launch) for any filter that
 * actually needs a specific path.
 */
export function parseDumpsysDeepLinks(output: string, pkg: string): DeepLinkFilter[] {
  const section = extractSection(output, /^\s*Schemes:\s*$/m);
  if (!section) return [];

  const headers = [...section.matchAll(FILTER_HEADER)];
  const results: DeepLinkFilter[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const component = header[1];
    // The resolver table can be system-wide rather than filtered to this package — only keep
    // filters that actually belong to the app being scanned.
    if (!component.startsWith(`${pkg}/`)) continue;

    const blockStart = (header.index ?? 0) + header[0].length;
    const blockEnd = i + 1 < headers.length ? (headers[i + 1].index ?? section.length) : section.length;
    const block = section.slice(blockStart, blockEnd);

    const schemeMatch = /Scheme:\s*"([^"]+)"/.exec(block);
    if (!schemeMatch) continue;
    const authorityMatch = /Authority:\s*"([^"]+)"/.exec(block);

    // Prefer the most literally-usable form: an exact Path, then a PathPrefix (still a real,
    // launchable path segment), and only fall back to PathPattern (wildcards, not launchable
    // as-is) when neither of the others is present.
    const pathMatch = /^\s*Path:\s*"([^"]+)"/m.exec(block);
    const pathPrefixMatch = /^\s*PathPrefix:\s*"([^"]+)"/m.exec(block);
    const pathPatternMatch = /^\s*PathPattern:\s*"([^"]+)"/m.exec(block);
    const path = pathMatch?.[1] ?? pathPrefixMatch?.[1] ?? pathPatternMatch?.[1] ?? null;
    const pathIsPattern = !pathMatch && !pathPrefixMatch && Boolean(pathPatternMatch);

    const key = `${component}|${schemeMatch[1]}|${authorityMatch?.[1] ?? ""}|${path ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      component,
      scheme: schemeMatch[1],
      host: authorityMatch?.[1] ?? null,
      path,
      pathIsPattern,
    });
  }

  return results;
}
