import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { LinuxFileType, dirname, type AdbSyncEntry } from "@yume-chan/adb";
import { useAdbStore } from "../../state/useAdbStore";
import { useFileBrowserStore, type FileViewMode } from "../../state/useFileBrowserStore";
import { IconBack, IconNewFolder, IconRefresh, IconSearch, IconShield, IconUpload } from "../icons";
import { splitBreadcrumbs } from "./pathUtils";
import { useFileBrowser } from "./useFileBrowser";
import { useFileSearch } from "./useFileSearch";
import { useThumbnails } from "./useThumbnails";
import { FileRow } from "./FileRow";
import { FileGrid } from "./FileGrid";
import { FilePreviewPanel } from "./FilePreviewPanel";

const VIEW_MODE_OPTIONS: { value: FileViewMode; label: string }[] = [
  { value: "list", label: "List" },
  { value: "icons", label: "Icons" },
  { value: "thumbnails", label: "Thumbnails" },
];

export function FileBrowserView() {
  const adb = useAdbStore((s) => s.adb);
  const rootAvailable = useAdbStore((s) => s.rootAvailable);
  const rootMode = useFileBrowserStore((s) => s.rootMode);
  const setRootMode = useFileBrowserStore((s) => s.setRootMode);
  const runAsPackage = useFileBrowserStore((s) => s.runAsPackage);
  const setRunAsPackage = useFileBrowserStore((s) => s.setRunAsPackage);
  const virtualFs = useFileBrowserStore((s) => s.virtualFs);
  const virtualLabel = useFileBrowserStore((s) => s.virtualLabel);
  const setVirtualSource = useFileBrowserStore((s) => s.setVirtualSource);
  const viewMode = useFileBrowserStore((s) => s.viewMode);
  const setViewMode = useFileBrowserStore((s) => s.setViewMode);
  const {
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
  } = useFileBrowser(adb, rootMode, runAsPackage, virtualFs);

  const [previewEntry, setPreviewEntry] = useState<AdbSyncEntry | null>(null);
  const thumbnails = useThumbnails(
    adb,
    queue,
    currentPath,
    entries,
    viewMode === "thumbnails",
    rootMode,
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const {
    results: searchResults,
    searching,
    error: searchError,
    search,
    cancel: cancelSearch,
    clear: clearSearchResults,
  } = useFileSearch(adb);

  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const breadcrumbs = splitBreadcrumbs(currentPath);

  useEffect(() => {
    setPreviewEntry(null);
    setSearchActive(false);
  }, [currentPath]);

  useEffect(() => {
    if (!rootAvailable) setRootMode(false);
  }, [rootAvailable]);

  // Thumbnails need per-file reads that aren't wired up for run-as/virtual mode (both stay
  // read-only via ls/cat-equivalents only) — fall back to a view that doesn't need them.
  useEffect(() => {
    if ((runAsPackage || virtualFs) && viewMode === "thumbnails") setViewMode("list");
  }, [runAsPackage, virtualFs, viewMode]);

  const handleExitVirtual = () => {
    setVirtualSource(null);
    navigate("/sdcard");
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    setSearchActive(true);
    void search(currentPath, searchQuery, { regex: searchRegex, rootMode });
  };

  const handleClearSearch = () => {
    setSearchActive(false);
    setSearchQuery("");
    clearSearchResults();
  };

  const handleOpenSearchResult = (path: string) => {
    navigate(dirname(path));
    handleClearSearch();
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    for (const file of e.dataTransfer.files) {
      void upload(file);
    }
  };

  const handleOpen = (entry: AdbSyncEntry) => {
    if (entry.type === LinuxFileType.Directory) {
      navigateInto(entry);
    } else {
      setPreviewEntry(entry);
    }
  };

  const handleFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void upload(file);
  };

  const handleNewFolder = () => {
    const name = window.prompt("New folder name");
    if (name) void mkdir(name);
  };

  const handleRename = (entry: AdbSyncEntry) => {
    const name = window.prompt("Rename to", entry.name);
    if (name && name !== entry.name) void rename(entry, name);
    setPreviewEntry(null);
  };

  const handleDelete = (entry: AdbSyncEntry) => {
    if (window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) {
      void remove(entry);
    }
    setPreviewEntry(null);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={navigateUp}
          title="Back"
          aria-label="Back"
          className="rounded border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800"
        >
          <IconBack />
        </button>
        <button
          type="button"
          onClick={refresh}
          title="Refresh"
          aria-label="Refresh"
          className="rounded border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800"
        >
          <IconRefresh />
        </button>
        <button
          type="button"
          onClick={handleNewFolder}
          disabled={!!runAsPackage || !!virtualFs}
          title={runAsPackage || virtualFs ? "Not available in read-only mode" : "New folder"}
          aria-label="New folder"
          className="rounded border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconNewFolder />
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!!runAsPackage || !!virtualFs}
          title={runAsPackage || virtualFs ? "Not available in read-only mode" : "Upload"}
          aria-label="Upload"
          className="rounded border border-neutral-700 p-1.5 text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconUpload />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />
        {loading && <span className="text-neutral-500">Loading…</span>}

        {rootAvailable && !virtualFs && (
          <button
            type="button"
            onClick={() => setRootMode(!rootMode)}
            title={rootMode ? "Root mode on — browsing as root" : "Browse as root"}
            className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
              rootMode
                ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
                : "border-neutral-700 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            <IconShield className="h-3.5 w-3.5" />
            Root
          </button>
        )}

        <div className="ml-auto flex gap-1">
          {VIEW_MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={opt.value === "thumbnails" && (!!runAsPackage || !!virtualFs)}
              onClick={() => setViewMode(opt.value)}
              className={`rounded px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-40 ${
                viewMode === opt.value
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-neutral-800 px-3 py-1.5 text-xs text-neutral-400">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex shrink-0 items-center gap-1">
            {i > 0 && <span className="text-neutral-700">/</span>}
            <button
              type="button"
              onClick={() => navigate(crumb.path)}
              className="hover:text-neutral-100 hover:underline"
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {!virtualFs && (
        <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5 text-xs">
          <IconSearch className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            placeholder={`Search recursively from ${currentPath}…`}
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-200 placeholder:text-neutral-600"
          />
          <label className="flex shrink-0 items-center gap-1 text-neutral-400">
            <input
              type="checkbox"
              checked={searchRegex}
              onChange={(e) => setSearchRegex(e.target.checked)}
            />
            Regex
          </label>
          {searching ? (
            <button
              type="button"
              onClick={cancelSearch}
              className="shrink-0 rounded border border-red-900 px-2 py-1 text-red-300 hover:bg-red-950"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSearch}
              disabled={!searchQuery.trim()}
              className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              Search
            </button>
          )}
          {searchActive && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800"
            >
              Clear
            </button>
          )}
          {searchActive && (
            <span className="shrink-0 text-neutral-500">
              {searchResults.length.toLocaleString()} matches
            </span>
          )}
        </div>
      )}

      {rootMode && (
        <div className="border-b border-emerald-900 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-300">
          Browsing as root — reads/writes go through <code>su</code>. Modified times may show "—"
          when the listing format can't be parsed reliably.
        </div>
      )}

      {runAsPackage && (
        <div className="flex items-center justify-between gap-2 border-b border-sky-900 bg-sky-950/30 px-3 py-1.5 text-xs text-sky-300">
          <span>
            Browsing <code>{runAsPackage}</code>'s private data via <code>run-as</code> — no root
            needed, but read-only (upload, new folder, rename, and delete are unavailable in this
            mode).
          </span>
          <button
            type="button"
            onClick={() => setRunAsPackage(null)}
            className="shrink-0 rounded border border-sky-800 px-2 py-0.5 text-sky-300 hover:bg-sky-900/40"
          >
            Exit run-as
          </button>
        </div>
      )}

      {virtualFs && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-900 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-300">
          <span>
            Browsing extracted contents of <code>{virtualLabel ?? "a backup archive"}</code> — not
            the live device filesystem, read-only.
          </span>
          <button
            type="button"
            onClick={handleExitVirtual}
            className="shrink-0 rounded border border-amber-800 px-2 py-0.5 text-amber-300 hover:bg-amber-900/40"
          >
            Exit backup view
          </button>
        </div>
      )}

      {searchError && (
        <div className="border-b border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {searchError}
        </div>
      )}

      {error && (
        <div className="border-b border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative min-h-0 min-w-0 flex-1 overflow-auto ${
            dragActive ? "outline-2 -outline-offset-2 outline-emerald-500" : ""
          }`}
        >
          {dragActive && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-emerald-950/60 text-sm text-emerald-300">
              Drop to upload to {currentPath}
            </div>
          )}
          {searchActive ? (
            searching && searchResults.length === 0 ? (
              <p className="p-8 text-center text-sm text-neutral-600">Searching…</p>
            ) : searchResults.length === 0 ? (
              <p className="p-8 text-center text-sm text-neutral-600">No matches.</p>
            ) : (
              searchResults.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => handleOpenSearchResult(path)}
                  className="block w-full truncate px-3 py-1 text-left font-mono text-xs text-neutral-300 hover:bg-neutral-900"
                >
                  {path}
                </button>
              ))
            )
          ) : entries.length === 0 && !loading ? (
            <div className="p-8 text-center text-neutral-600">Empty directory.</div>
          ) : viewMode === "list" ? (
            <>
              <div className="flex items-center gap-3 border-b border-neutral-800 px-3 py-1 text-xs text-neutral-500">
                <span className="min-w-0 flex-1">Name</span>
                <span className="w-20 shrink-0 text-right">Size</span>
                <span className="w-40 shrink-0">Modified</span>
                <span className="w-20 shrink-0">Permissions</span>
                <span className="w-[124px] shrink-0" />
              </div>
              {entries.map((entry) => (
                <FileRow
                  key={entry.name}
                  entry={entry}
                  onOpen={handleOpen}
                  onDownload={(e) => void download(e)}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  fetchBlob={fetchBlob}
                  readOnly={!!runAsPackage || !!virtualFs}
                />
              ))}
            </>
          ) : (
            <FileGrid
              entries={entries}
              mode={viewMode}
              thumbnails={thumbnails}
              currentPath={currentPath}
              onOpen={handleOpen}
              fetchBlob={fetchBlob}
            />
          )}
        </div>

        {previewEntry && (adb || virtualFs) && (
          <FilePreviewPanel
            adb={adb}
            queue={queue}
            rootMode={rootMode}
            runAsPackage={runAsPackage}
            virtualFs={virtualFs}
            currentPath={currentPath}
            entry={previewEntry}
            onClose={() => setPreviewEntry(null)}
            onDownload={(e) => void download(e)}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}
