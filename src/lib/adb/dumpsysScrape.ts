/**
 * Shared primitives for scraping `dumpsys` output. `dumpsys` isn't a documented/stable format —
 * it varies across Android versions and OEM skins — so rather than modeling any of it structurally,
 * these scope to one section by indentation, then pattern-match only the specific substring
 * needed within it. Resilient to formatting differences since none of this depends on exact
 * spacing or line shape, only on the patterns being unique enough not to false-positive elsewhere
 * in the dump. Used by `dumpsysPackage.ts`.
 */

/** Collects every line after a header match, until a line at the same or lesser indentation. */
export function extractSection(output: string, header: RegExp): string {
  const lines = output.split("\n");
  const startIdx = lines.findIndex((line) => header.test(line));
  if (startIdx === -1) return "";

  const startIndent = lines[startIdx].match(/^(\s*)/)?.[1].length ?? 0;
  const sectionLines: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      sectionLines.push(line);
      continue;
    }
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent <= startIndent) break;
    sectionLines.push(line);
  }
  return sectionLines.join("\n");
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds every `<pkg>/<Component>` token within a section — the telltale shape of a component
 * reference, regardless of what indentation/label format wraps it. */
export function extractComponents(section: string, pkg: string): string[] {
  const pattern = new RegExp(`${escapeRegExp(pkg)}/[\\w.$]+`, "g");
  const found = new Set<string>();
  for (const match of section.matchAll(pattern)) found.add(match[0]);
  return [...found].sort();
}

export function extractFirstMatch(output: string, pattern: RegExp): string | null {
  return pattern.exec(output)?.[1] ?? null;
}
