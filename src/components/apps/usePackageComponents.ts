import { useState } from "react";
import { escapeArg, type Adb } from "@yume-chan/adb";
import { parseDumpsysPackage } from "../../lib/adb/dumpsysPackage";
import { useAppsStore } from "../../state/useAppsStore";

export function usePackageComponents(adb: Adb | null) {
  const cache = useAppsStore((s) => s.componentsByPackage);
  const setComponents = useAppsStore((s) => s.setComponents);
  const [loadingPkg, setLoadingPkg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (pkg: string): Promise<void> => {
    if (!adb) return;
    setLoadingPkg(pkg);
    setError(null);
    try {
      const output = await adb.subprocess.noneProtocol.spawnWaitText([
        "dumpsys",
        "package",
        escapeArg(pkg),
      ]);
      setComponents(pkg, parseDumpsysPackage(output, pkg));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPkg(null);
    }
  };

  const fetchComponents = async (pkg: string): Promise<void> => {
    if (cache.has(pkg)) return;
    await load(pkg);
  };

  /** Always re-fetches, bypassing the cache — used by the explicit "Run Scan"/"Re-scan" action
   * so results reflect the device's current state even if this package was already scanned
   * earlier (possibly in an earlier visit to this tab, since the cache now persists). */
  const rescan = async (pkg: string): Promise<void> => {
    await load(pkg);
  };

  return { cache, loadingPkg, error, fetchComponents, rescan };
}
