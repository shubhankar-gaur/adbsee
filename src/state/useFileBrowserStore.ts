import { create } from "zustand";
import type { VirtualFs } from "../lib/androidBackup/virtualFs";

export type FileViewMode = "list" | "icons" | "thumbnails";

interface FileBrowserState {
  currentPath: string;
  viewMode: FileViewMode;
  rootMode: boolean;
  /** Non-null when browsing a debuggable app's private data via `run-as <pkg>` instead of `su` —
   * mutually exclusive with `rootMode`/`virtualFs` (setting one clears the others). Read-only:
   * write operations (upload/mkdir/rename/remove) stay disabled in the UI while this is set. */
  runAsPackage: string | null;
  /** Non-null when browsing the extracted contents of a parsed backup archive instead of the
   * live device filesystem — mutually exclusive with `rootMode`/`runAsPackage`, and always
   * read-only (there's no device to write back to). `virtualLabel` is just a human-readable name
   * for the UI banner (e.g. the package the backup came from). */
  virtualFs: VirtualFs | null;
  virtualLabel: string | null;
  setCurrentPath: (path: string) => void;
  setViewMode: (mode: FileViewMode) => void;
  setRootMode: (rootMode: boolean) => void;
  setRunAsPackage: (pkg: string | null) => void;
  setVirtualSource: (fs: VirtualFs | null, label?: string) => void;
}

/**
 * Lives outside the Files tab's component tree so browsing state survives switching to another
 * tab and back — the view previously reset to /sdcard every time because this state was local
 * `useState`, torn down whenever `FileBrowserView` unmounted.
 */
export const useFileBrowserStore = create<FileBrowserState>()((set) => ({
  currentPath: "/sdcard",
  viewMode: "list",
  rootMode: false,
  runAsPackage: null,
  virtualFs: null,
  virtualLabel: null,
  setCurrentPath: (currentPath) => set({ currentPath }),
  setViewMode: (viewMode) => set({ viewMode }),
  setRootMode: (rootMode) =>
    set({ rootMode, ...(rootMode ? { runAsPackage: null, virtualFs: null, virtualLabel: null } : {}) }),
  setRunAsPackage: (runAsPackage) =>
    set({ runAsPackage, ...(runAsPackage ? { rootMode: false, virtualFs: null, virtualLabel: null } : {}) }),
  setVirtualSource: (virtualFs, label) =>
    set({
      virtualFs,
      virtualLabel: virtualFs ? (label ?? null) : null,
      ...(virtualFs ? { rootMode: false, runAsPackage: null } : {}),
    }),
}));
