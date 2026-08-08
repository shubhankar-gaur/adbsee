import { LinuxFileType, type AdbSyncEntry } from "@yume-chan/adb";
import type { TarEntry } from "./tar";

const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const DEFAULT_DIR_PERM = 0o755;
const DEFAULT_FILE_PERM = 0o644;

export interface VirtualFs {
  list(path: string): AdbSyncEntry[];
  read(path: string): Uint8Array | null;
}

function normalize(name: string): string {
  return `/${name.replace(/^(\.\/)+/, "").replace(/\/+$/, "")}`;
}

/**
 * Builds an in-memory directory tree over a flat list of tar entries (posix paths, no leading
 * slash) so the Files tab can browse a parsed Android backup exactly like a real device path —
 * `useFileBrowser`'s virtual branch synthesizes `AdbSyncEntry` listings from this the same way
 * `rootLs.ts`'s `parseRootLsOutput` does for `su -c ls -la` text output: same target shape, just a
 * different source of truth, so every downstream UI piece (`FileRow`, `FilePreviewPanel`, etc.)
 * needs no special-casing.
 */
export function buildVirtualFs(entries: TarEntry[]): VirtualFs {
  const files = new Map<string, TarEntry>();
  const dirs = new Set<string>(["/"]);

  for (const entry of entries) {
    const path = normalize(entry.name);
    if (path === "/") continue;
    if (entry.typeflag === "5") {
      dirs.add(path);
      continue;
    }
    if (entry.typeflag === "L") continue; // GNU long-name marker, already folded in by parseTar
    files.set(path, entry);
    const segments = path.split("/").filter(Boolean);
    segments.pop();
    let acc = "";
    for (const segment of segments) {
      acc += `/${segment}`;
      dirs.add(acc);
    }
  }

  function directChildName(fullPath: string, prefix: string): string | null {
    if (!fullPath.startsWith(prefix)) return null;
    const rest = fullPath.slice(prefix.length);
    if (rest === "" || rest.includes("/")) return null;
    return rest;
  }

  function list(path: string): AdbSyncEntry[] {
    const prefix = path === "/" ? "/" : `${path}/`;
    const out: AdbSyncEntry[] = [];
    for (const dirPath of dirs) {
      const name = directChildName(dirPath, prefix);
      if (!name) continue;
      out.push({
        name,
        type: LinuxFileType.Directory,
        permission: DEFAULT_DIR_PERM,
        size: 0n,
        mtime: 0n,
        mode: S_IFDIR | DEFAULT_DIR_PERM,
      });
    }
    for (const [filePath, entry] of files) {
      const name = directChildName(filePath, prefix);
      if (!name) continue;
      out.push({
        name,
        type: LinuxFileType.File,
        permission: DEFAULT_FILE_PERM,
        size: BigInt(entry.size),
        mtime: 0n,
        mode: S_IFREG | DEFAULT_FILE_PERM,
      });
    }
    return out;
  }

  function read(path: string): Uint8Array | null {
    return files.get(path)?.data ?? null;
  }

  return { list, read };
}
