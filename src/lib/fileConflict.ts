/** Generates "name (1).ext", "name (2).ext", etc., skipping any that already exist —
 * matches how Chrome/Windows resolve duplicate downloads/copies by default. */
export function suggestNonConflictingName(name: string, existingNames: ReadonlySet<string>): string {
  const dotIdx = name.lastIndexOf(".");
  // A leading-dot dotfile (".bashrc") has no extension to preserve.
  const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : "";

  let i = 1;
  let candidate = `${base} (${i})${ext}`;
  while (existingNames.has(candidate)) {
    i += 1;
    candidate = `${base} (${i})${ext}`;
  }
  return candidate;
}
