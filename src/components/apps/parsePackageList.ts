export interface PackageEntry {
  packageName: string;
}

// Deliberately doesn't use `pm list packages -f` — that only ever shows one (the base) APK's
// path, which is misleading to display as "the" APK path for apps shipped as a split install
// (base + per-density/ABI config splits, or dynamic feature modules). `pm path <pkg>` (see
// `parsePmPathOutput` below) is the correct way to list every APK a package actually installs
// as, and is fetched on demand (Pull APK, the DEX extras scanner) rather than eagerly for the
// whole list.
/** Parses `pm list packages` output: `package:com.example.app` per line. */
export function parsePackageList(output: string): PackageEntry[] {
  const entries: PackageEntry[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("package:")) continue;
    const packageName = trimmed.slice("package:".length);
    if (packageName) entries.push({ packageName });
  }
  return entries.sort((a, b) => a.packageName.localeCompare(b.packageName));
}

/** Parses `pm path <pkg>` output: one `package:/path.apk` line per split APK. */
export function parsePmPathOutput(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package:"))
    .map((line) => line.slice("package:".length));
}
