import { useCallback, useEffect, useMemo, useState } from "react";
import { escapeArg, LinuxFileType, type Adb, type AdbSyncEntry } from "@yume-chan/adb";
import { downloadBlob } from "../../lib/downloadBlob";
import { downloadFile } from "../../lib/adb/downloadFile";
import { readFileFull, readFileRootFull, readFileRunAsFull } from "../../lib/adb/readFile";
import { runAsCommand } from "../../lib/adb/runAsCommand";
import { suCommand, suShellCommand } from "../../lib/adb/suCommand";
import { toSyncWritable } from "../../lib/adb/toSyncWritable";
import { suggestNonConflictingName } from "../../lib/fileConflict";
import { withProgress } from "../../lib/progressStream";
import { trackTransfer } from "../../lib/transfers";
import { useConflictDialogStore } from "../../state/useConflictDialogStore";
import { useFileBrowserStore } from "../../state/useFileBrowserStore";
import type { VirtualFs } from "../../lib/androidBackup/virtualFs";
import { joinPath } from "./pathUtils";
import { parseRootLsOutput } from "./rootLs";
import { SyncQueue } from "./syncQueue";

function sortEntries(list: AdbSyncEntry[]): AdbSyncEntry[] {
  return [...list]
    .filter((e) => e.name !== "." && e.name !== "..")
    .sort((a, b) => {
      const aDir = a.type === LinuxFileType.Directory;
      const bDir = b.type === LinuxFileType.Directory;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

const READ_ONLY_ERROR = new Error("Browsing a backup archive — read-only, there's no device to write back to.");

export function useFileBrowser(
  adb: Adb | null,
  rootMode: boolean,
  runAsPackage: string | null = null,
  virtualFs: VirtualFs | null = null,
) {
  const currentPath = useFileBrowserStore((s) => s.currentPath);
  const setCurrentPath = useFileBrowserStore((s) => s.setCurrentPath);
  const [entries, setEntries] = useState<AdbSyncEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useMemo(() => new SyncQueue(), [adb]);

  const refresh = useCallback(() => {
    if (virtualFs) {
      setError(null);
      try {
        setEntries(sortEntries(virtualFs.list(currentPath)));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      }
      return;
    }
    if (!adb) return;
    setLoading(true);
    setError(null);
    queue
      .run(async () => {
        if (runAsPackage) {
          const output = await adb.subprocess.noneProtocol.spawnWaitText(
            runAsCommand(runAsPackage, ["ls", "-la", currentPath]),
          );
          return parseRootLsOutput(output);
        }
        if (rootMode) {
          const output = await adb.subprocess.noneProtocol.spawnWaitText(
            suCommand(["ls", "-la", currentPath]),
          );
          return parseRootLsOutput(output);
        }
        const sync = await adb.sync();
        try {
          return await sync.readdir(currentPath);
        } finally {
          await sync.dispose();
        }
      })
      .then((list) => setEntries(sortEntries(list)))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, [adb, currentPath, queue, rootMode, runAsPackage, virtualFs]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const navigate = (path: string) => setCurrentPath(path);

  const navigateInto = (entry: AdbSyncEntry) => {
    if (entry.type === LinuxFileType.Directory) {
      setCurrentPath(joinPath(currentPath, entry.name));
    }
  };

  const navigateUp = () => {
    if (currentPath === "/") return;
    const idx = currentPath.lastIndexOf("/");
    setCurrentPath(idx <= 0 ? "/" : currentPath.slice(0, idx));
  };

  const download = (entry: AdbSyncEntry): Promise<void> => {
    if (virtualFs) {
      const path = joinPath(currentPath, entry.name);
      const data = virtualFs.read(path);
      if (!data) return Promise.reject(new Error("File not found in this backup"));
      downloadBlob(new Blob([data as BlobPart]), entry.name);
      return Promise.resolve();
    }
    if (!adb) return Promise.reject(new Error("Not connected"));
    const path = joinPath(currentPath, entry.name);
    const bytesTotal = Number(entry.size);
    if (runAsPackage) {
      return queue.run(() =>
        trackTransfer("download", entry.name, bytesTotal, async (onProgress) => {
          const bytes = await readFileRunAsFull(adb, runAsPackage, path, onProgress);
          downloadBlob(new Blob([bytes as BlobPart]), entry.name);
        }),
      );
    }
    if (rootMode) {
      return queue.run(() =>
        trackTransfer("download", entry.name, bytesTotal, async (onProgress) => {
          const bytes = await readFileRootFull(adb, path, onProgress);
          downloadBlob(new Blob([bytes as BlobPart]), entry.name);
        }),
      );
    }
    return queue.run(() =>
      trackTransfer("download", entry.name, bytesTotal, (onProgress) =>
        downloadFile(adb, path, entry.name, onProgress),
      ),
    );
  };

  const upload = async (file: File): Promise<void> => {
    if (virtualFs || !adb) return;

    let targetName = file.name;
    if (entries.some((e) => e.name === file.name)) {
      const suggested = suggestNonConflictingName(file.name, new Set(entries.map((e) => e.name)));
      const resolution = await useConflictDialogStore.getState().request(file.name, suggested);
      if (resolution.action === "skip") return;
      if (resolution.action === "rename") targetName = resolution.name;
    }

    const path = joinPath(currentPath, targetName);
    await queue.run(() =>
      trackTransfer("upload", targetName, file.size, async (onProgress) => {
        // The sync connection always writes as adbd's own (usually unprivileged) user, even with
        // root available — so a root-mode upload lands in a world-writable temp spot first, then
        // gets moved into place as root.
        const tempPath = rootMode ? `/data/local/tmp/${targetName}` : path;
        const sync = await adb.sync();
        try {
          await sync.write({
            filename: tempPath,
            file: toSyncWritable(withProgress(file.stream(), onProgress)),
          });
        } finally {
          await sync.dispose();
        }
        if (rootMode) {
          await adb.subprocess.noneProtocol.spawnWaitText(
            suShellCommand(
              `cp ${escapeArg(tempPath)} ${escapeArg(path)} && rm -f ${escapeArg(tempPath)}`,
            ),
          );
        }
      }),
    );
    refresh();
  };

  // Deliberately bypasses `queue` — this is a speculative, best-effort background fetch
  // (triggered on hover, for drag-out-to-download) that shouldn't be able to block, or be
  // blocked by, a real user-initiated operation like a rename or a real download.
  const fetchBlob = async (entry: AdbSyncEntry): Promise<Blob> => {
    if (virtualFs) {
      const path = joinPath(currentPath, entry.name);
      const data = virtualFs.read(path);
      if (!data) throw new Error("File not found in this backup");
      return new Blob([data as BlobPart]);
    }
    if (!adb) throw new Error("Not connected");
    const path = joinPath(currentPath, entry.name);
    const bytes = runAsPackage
      ? await readFileRunAsFull(adb, runAsPackage, path)
      : rootMode
        ? await readFileRootFull(adb, path)
        : await readFileFull(adb, path);
    return new Blob([bytes as BlobPart]);
  };

  const mkdir = (name: string): Promise<void> => {
    if (virtualFs) return Promise.reject(READ_ONLY_ERROR);
    if (!adb) return Promise.reject(new Error("Not connected"));
    const path = joinPath(currentPath, name);
    const command = rootMode
      ? suCommand(["mkdir", "-p", path])
      : ["mkdir", "-p", escapeArg(path)];
    return queue.run(() => adb.subprocess.noneProtocol.spawnWaitText(command)).then(() => refresh());
  };

  const rename = (entry: AdbSyncEntry, newName: string): Promise<void> => {
    if (virtualFs) return Promise.reject(READ_ONLY_ERROR);
    if (!adb) return Promise.reject(new Error("Not connected"));
    const from = joinPath(currentPath, entry.name);
    const to = joinPath(currentPath, newName);
    const command = rootMode
      ? suCommand(["mv", from, to])
      : ["mv", escapeArg(from), escapeArg(to)];
    return queue.run(() => adb.subprocess.noneProtocol.spawnWaitText(command)).then(() => refresh());
  };

  const remove = (entry: AdbSyncEntry): Promise<void> => {
    if (virtualFs) return Promise.reject(READ_ONLY_ERROR);
    if (!adb) return Promise.reject(new Error("Not connected"));
    const path = joinPath(currentPath, entry.name);
    const isDir = entry.type === LinuxFileType.Directory;
    if (rootMode) {
      return queue
        .run(() =>
          adb.subprocess.noneProtocol.spawnWaitText(suCommand(["rm", isDir ? "-rf" : "-f", path])),
        )
        .then(() => refresh());
    }
    return queue.run(() => adb.rm(path, { recursive: isDir, force: true })).then(() => refresh());
  };

  return {
    currentPath,
    entries,
    loading,
    error,
    queue,
    navigate,
    navigateInto,
    navigateUp,
    refresh,
    download,
    upload,
    fetchBlob,
    mkdir,
    rename,
    remove,
  };
}
