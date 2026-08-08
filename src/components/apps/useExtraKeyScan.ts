import { useState } from "react";
import { escapeArg, type Adb } from "@yume-chan/adb";
import { readFileFull } from "../../lib/adb/readFile";
import { extractDexFiles } from "../../lib/zip/apkZip";
import { parseDexHeader, componentToDescriptor, type DexFile } from "../../lib/dex/dexHeader";
import { classDefExists } from "../../lib/dex/classData";
import { scanClassHierarchyForExtras, type DetectedExtra } from "../../lib/dex/extraKeyScanner";
import { parsePmPathOutput } from "./parsePackageList";

// All dex files (not just the one containing the target class) are needed up front, since the
// superclass-chain walk (see extraKeyScanner.ts) may need to follow into a different classes*.dex
// than the one the component's own class lives in.
async function loadAllDexFiles(adb: Adb, apkPaths: string[]): Promise<DexFile[]> {
  const dexFiles: DexFile[] = [];
  for (const apkPath of apkPaths) {
    const apkBytes = await readFileFull(adb, apkPath);
    for (const dexBytes of extractDexFiles(apkBytes)) {
      dexFiles.push(parseDexHeader(dexBytes));
    }
  }
  return dexFiles;
}

/**
 * Best-effort DEX scan for a component's Intent/Bundle extras — see the design notes in
 * `src/lib/dex/extraKeyScanner.ts`. Not persisted across tab switches (unlike the package list
 * and component scan cache): this is a rarer, deeper drill-down per component, cheap enough to
 * re-run on demand.
 */
export function useExtraKeyScan(adb: Adb | null) {
  const [cache, setCache] = useState<Map<string, DetectedExtra[]>>(new Map());
  const [scanningComponent, setScanningComponent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = async (pkg: string, component: string): Promise<void> => {
    if (!adb) return;
    setScanningComponent(component);
    setError(null);
    try {
      const pathOutput = await adb.subprocess.noneProtocol.spawnWaitText([
        "pm",
        "path",
        escapeArg(pkg),
      ]);
      const apkPaths = parsePmPathOutput(pathOutput);
      if (apkPaths.length === 0) throw new Error("Could not find an APK path for this package.");

      const descriptor = componentToDescriptor(component);
      const dexFiles = await loadAllDexFiles(adb, apkPaths);
      const exists = dexFiles.some((dex) => classDefExists(dex, descriptor));
      const found = exists ? scanClassHierarchyForExtras(dexFiles, descriptor) : null;

      setCache((prev) => new Map(prev).set(component, found ?? []));
      if (!found) {
        setError(
          `"${component}" wasn't found in any classes.dex under this app's APK(s) — it may be a ` +
            "synthetic/generated component, or defined in a dynamic feature module not covered here.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanningComponent(null);
    }
  };

  return { cache, scanningComponent, error, scan };
}
