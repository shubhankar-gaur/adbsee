import { useCallback, useEffect, useState } from "react";
import { escapeArg, type Adb } from "@yume-chan/adb";
import { downloadFile } from "../../lib/adb/downloadFile";
import { toSyncWritable } from "../../lib/adb/toSyncWritable";
import { withProgress } from "../../lib/progressStream";
import { trackTransfer } from "../../lib/transfers";
import { useAppsStore } from "../../state/useAppsStore";
import { parsePackageList, parsePmPathOutput } from "./parsePackageList";

export function useAppManager(adb: Adb | null) {
  const packages = useAppsStore((s) => s.packages);
  const setPackages = useAppsStore((s) => s.setPackages);
  const thirdPartyOnly = useAppsStore((s) => s.thirdPartyOnly);
  const setThirdPartyOnly = useAppsStore((s) => s.setThirdPartyOnly);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPackage, setBusyPackage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!adb) return;
    setLoading(true);
    setError(null);
    const args = thirdPartyOnly
      ? ["pm", "list", "packages", "-3"]
      : ["pm", "list", "packages"];
    adb.subprocess.noneProtocol
      .spawnWaitText(args)
      .then((output) => setPackages(parsePackageList(output)))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setPackages([]);
      })
      .finally(() => setLoading(false));
  }, [adb, thirdPartyOnly, setPackages]);

  // Deliberately one-shot: only fetch if nothing's cached yet (a fresh device connection resets
  // `packages` back to empty — see `resetAppsState` in useAdbStore.ts). Switching tabs away and
  // back must NOT re-trigger this — that was the whole point of moving `packages` into
  // useAppsStore instead of local state.
  useEffect(() => {
    if (adb && packages.length === 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adb]);

  const withBusy = async (key: string, task: () => Promise<void>): Promise<void> => {
    setBusyPackage(key);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyPackage(null);
    }
  };

  const install = (file: File): Promise<void> => {
    if (!adb) return Promise.reject(new Error("Not connected"));
    return withBusy(file.name, async () => {
      const remotePath = `/data/local/tmp/${file.name}`;
      await trackTransfer("upload", file.name, file.size, async (onProgress) => {
        const sync = await adb.sync();
        try {
          await sync.write({
            filename: remotePath,
            file: toSyncWritable(withProgress(file.stream(), onProgress)),
          });
        } finally {
          await sync.dispose();
        }
      });
      await adb.subprocess.noneProtocol.spawnWaitText(["pm", "install", escapeArg(remotePath)]);
      await adb.rm(remotePath, { force: true });
      refresh();
    });
  };

  const uninstall = (pkg: string): Promise<void> => {
    if (!adb) return Promise.reject(new Error("Not connected"));
    return withBusy(pkg, async () => {
      await adb.subprocess.noneProtocol.spawnWaitText(["pm", "uninstall", escapeArg(pkg)]);
      // The detail panel would otherwise keep showing a now-uninstalled package's stale data.
      const appsStore = useAppsStore.getState();
      if (appsStore.selectedPackage === pkg) appsStore.setSelectedPackage(null);
      refresh();
    });
  };

  const forceStop = (pkg: string): Promise<void> => {
    if (!adb) return Promise.reject(new Error("Not connected"));
    return withBusy(pkg, async () => {
      await adb.subprocess.noneProtocol.spawnWaitText(["am", "force-stop", escapeArg(pkg)]);
    });
  };

  const clearData = (pkg: string): Promise<void> => {
    if (!adb) return Promise.reject(new Error("Not connected"));
    return withBusy(pkg, async () => {
      await adb.subprocess.noneProtocol.spawnWaitText(["pm", "clear", escapeArg(pkg)]);
    });
  };

  const pullApk = (pkg: string): Promise<void> => {
    if (!adb) return Promise.reject(new Error("Not connected"));
    return withBusy(pkg, async () => {
      const output = await adb.subprocess.noneProtocol.spawnWaitText([
        "pm",
        "path",
        escapeArg(pkg),
      ]);
      const paths = parsePmPathOutput(output);
      for (let i = 0; i < paths.length; i++) {
        const filename = paths.length > 1 ? `${pkg}-${i}.apk` : `${pkg}.apk`;
        const sync = await adb.sync();
        let size = 0;
        try {
          size = Number((await sync.stat(paths[i])).size);
        } finally {
          await sync.dispose();
        }
        await trackTransfer("download", filename, size, (onProgress) =>
          downloadFile(adb, paths[i], filename, onProgress),
        );
      }
    });
  };

  return {
    packages,
    thirdPartyOnly,
    setThirdPartyOnly,
    loading,
    error,
    busyPackage,
    refresh,
    install,
    uninstall,
    forceStop,
    clearData,
    pullApk,
  };
}
