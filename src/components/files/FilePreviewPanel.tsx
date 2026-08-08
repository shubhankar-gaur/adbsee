import { useEffect, useRef, useState } from "react";
import type { Adb, AdbSyncEntry } from "@yume-chan/adb";
import {
  readFileFull,
  readFileHead,
  readFileRange,
  readFileRootFull,
  readFileRootHead,
  readFileRootRange,
  readFileRunAsFull,
  readFileRunAsHead,
  readFileRunAsRange,
} from "../../lib/adb/readFile";
import { toHex } from "../../lib/hexDump";
import type { VirtualFs } from "../../lib/androidBackup/virtualFs";
import { formatSize, formatMtime, formatPermissions, typeIcon } from "./formatters";
import { isImageFile, isTextFile, joinPath } from "./pathUtils";
import type { SyncQueue } from "./syncQueue";

const INITIAL_PREVIEW_BYTES = 512;
const MAX_PREVIEW_BYTES = 65_536;
const WINDOW_SIZE = MAX_PREVIEW_BYTES;
const SLIDER_DEBOUNCE_MS = 200;
const IMAGE_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
const textDecoder = new TextDecoder("utf-8");

export interface FilePreviewPanelProps {
  adb: Adb | null;
  queue: SyncQueue;
  rootMode: boolean;
  runAsPackage: string | null;
  /** Non-null when previewing a file from a parsed backup archive instead of the live device —
   * takes priority over `rootMode`/`runAsPackage`/`adb`, all of which are irrelevant here. */
  virtualFs: VirtualFs | null;
  currentPath: string;
  entry: AdbSyncEntry;
  onClose: () => void;
  onDownload: (entry: AdbSyncEntry) => void;
  onRename: (entry: AdbSyncEntry) => void;
  onDelete: (entry: AdbSyncEntry) => void;
}

type PreviewState =
  | { kind: "loading" }
  | { kind: "image"; url: string }
  | { kind: "text" | "hex"; text: string; truncated: boolean; capBytes: number }
  | { kind: "error"; message: string };

export function FilePreviewPanel({
  adb,
  queue,
  rootMode,
  runAsPackage,
  virtualFs,
  currentPath,
  entry,
  onClose,
  onDownload,
  onRename,
  onDelete,
}: FilePreviewPanelProps) {
  const path = joinPath(currentPath, entry.name);
  const fileSize = Number(entry.size);
  // Bigger than anything sequential scroll-growth could ever show (it caps at MAX_PREVIEW_BYTES)
  // — the slider is the only way to see past that point without downloading the whole file.
  const isLongFile = fileSize > MAX_PREVIEW_BYTES;
  const maxWindowOffset = Math.max(0, fileSize - WINDOW_SIZE);

  const [state, setState] = useState<PreviewState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [windowOffset, setWindowOffset] = useState(0);
  const [windowedMode, setWindowedMode] = useState(false);
  const cancelledRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const sliderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const readHead = (maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> => {
    if (virtualFs) {
      const data = virtualFs.read(path) ?? new Uint8Array(0);
      return Promise.resolve({ bytes: data.subarray(0, maxBytes), truncated: data.length > maxBytes });
    }
    if (!adb) return Promise.reject(new Error("Not connected"));
    return runAsPackage
      ? readFileRunAsHead(adb, runAsPackage, path, maxBytes)
      : rootMode
        ? readFileRootHead(adb, path, maxBytes)
        : readFileHead(adb, path, maxBytes);
  };

  const readRange = (offset: number, length: number): Promise<Uint8Array> => {
    if (virtualFs) {
      const data = virtualFs.read(path) ?? new Uint8Array(0);
      return Promise.resolve(data.subarray(offset, offset + length));
    }
    if (!adb) return Promise.reject(new Error("Not connected"));
    return runAsPackage
      ? readFileRunAsRange(adb, runAsPackage, path, offset, length)
      : rootMode
        ? readFileRootRange(adb, path, offset, length)
        : readFileRange(adb, path, offset, length);
  };

  useEffect(() => {
    cancelledRef.current = false;
    let createdUrl: string | null = null;
    setState({ kind: "loading" });
    setWindowOffset(0);
    setWindowedMode(false);
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);

    void (async () => {
      try {
        if (isImageFile(entry.name) && entry.size <= IMAGE_PREVIEW_MAX_BYTES) {
          const bytes = await queue.run(async () => {
            if (virtualFs) return virtualFs.read(path) ?? new Uint8Array(0);
            if (!adb) throw new Error("Not connected");
            return runAsPackage
              ? readFileRunAsFull(adb, runAsPackage, path)
              : rootMode
                ? readFileRootFull(adb, path)
                : readFileFull(adb, path);
          });
          if (cancelledRef.current) return;
          const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
          createdUrl = url;
          setState({ kind: "image", url });
        } else {
          const kind: "text" | "hex" = isTextFile(entry.name) ? "text" : "hex";
          const { bytes, truncated } = await queue.run(() => readHead(INITIAL_PREVIEW_BYTES));
          if (cancelledRef.current) return;
          setState({
            kind,
            text: kind === "text" ? textDecoder.decode(bytes) : toHex(bytes),
            truncated,
            capBytes: INITIAL_PREVIEW_BYTES,
          });
        }
      } catch (err) {
        if (!cancelledRef.current) {
          setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adb, queue, path, rootMode, runAsPackage, virtualFs]);

  const handleLoadMore = async (): Promise<void> => {
    if ((state.kind !== "text" && state.kind !== "hex") || loadingMoreRef.current) return;
    const kind = state.kind;
    const nextCap = Math.min(state.capBytes * 4, MAX_PREVIEW_BYTES);
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const { bytes, truncated } = await queue.run(() => readHead(nextCap));
      if (cancelledRef.current) return;
      setState({
        kind,
        text: kind === "text" ? textDecoder.decode(bytes) : toHex(bytes),
        truncated,
        capBytes: nextCap,
      });
    } catch (err) {
      if (!cancelledRef.current) {
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      loadingMoreRef.current = false;
      if (!cancelledRef.current) setLoadingMore(false);
    }
  };

  const canLoadMore =
    !windowedMode &&
    (state.kind === "text" || state.kind === "hex") &&
    state.truncated &&
    state.capBytes < MAX_PREVIEW_BYTES;

  // Loads more automatically as the sentinel below the content scrolls into view, instead of
  // requiring a manual "Load more" click — re-attaches whenever the loaded content changes so it
  // correctly stops observing once the file is fully loaded or the preview cap is hit.
  useEffect(() => {
    if (!canLoadMore) return;
    const sentinel = sentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries[0]?.isIntersecting) void handleLoadMore();
      },
      { root, rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadMore, state]);

  // Scrubs to an arbitrary offset — for a file too large to ever fully reach via sequential
  // scroll-growth. Once used, this fully replaces the scroll-to-grow view (a stale "truncated"
  // flag from the sequential load doesn't mean anything once the content on screen came from an
  // arbitrary offset instead of the start).
  const fetchWindow = async (kind: "text" | "hex", offset: number): Promise<void> => {
    setLoadingMore(true);
    try {
      const bytes = await queue.run(() => readRange(offset, WINDOW_SIZE));
      if (cancelledRef.current) return;
      setState({
        kind,
        text: kind === "text" ? textDecoder.decode(bytes) : toHex(bytes),
        truncated: false,
        capBytes: WINDOW_SIZE,
      });
    } catch (err) {
      if (!cancelledRef.current) {
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (!cancelledRef.current) setLoadingMore(false);
    }
  };

  const handleSliderChange = (offset: number) => {
    setWindowOffset(offset);
    setWindowedMode(true);
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    const kind = state.kind === "text" || state.kind === "hex" ? state.kind : null;
    if (!kind) return;
    sliderDebounceRef.current = setTimeout(() => void fetchWindow(kind, offset), SLIDER_DEBOUNCE_MS);
  };

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 truncate text-sm text-neutral-200">
          <span>{typeIcon(entry.type)}</span>
          <span className="truncate">{entry.name}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-neutral-500 hover:text-neutral-200"
          aria-label="Close preview"
        >
          ✕
        </button>
      </div>

      <div className="space-y-1 border-b border-neutral-800 px-3 py-2 text-xs text-neutral-500">
        <div className="flex justify-between">
          <span>Size</span>
          <span className="text-neutral-300">{formatSize(entry.size)}</span>
        </div>
        <div className="flex justify-between">
          <span>Modified</span>
          <span className="text-neutral-300">{formatMtime(entry.mtime)}</span>
        </div>
        <div className="flex justify-between">
          <span>Permissions</span>
          <span className="font-mono text-neutral-300">
            {formatPermissions(entry.permission)}
          </span>
        </div>
      </div>

      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-auto p-3">
        {state.kind === "loading" && <p className="text-sm text-neutral-600">Loading…</p>}
        {state.kind === "error" && <p className="text-sm text-red-300">{state.message}</p>}
        {state.kind === "image" && (
          <img src={state.url} alt={entry.name} className="max-w-full rounded" />
        )}
        {(state.kind === "text" || state.kind === "hex") && (
          <>
            <pre
              className={`overflow-x-auto font-mono text-xs text-neutral-300 ${
                state.kind === "text" ? "whitespace-pre-wrap break-words" : "whitespace-pre"
              }`}
            >
              {state.text || "(empty file)"}
            </pre>

            {!windowedMode &&
              state.truncated &&
              (state.capBytes < MAX_PREVIEW_BYTES ? (
                <div ref={sentinelRef} className="py-2 text-center text-xs text-neutral-600">
                  {loadingMore ? "Loading more…" : "Scroll for more"}
                </div>
              ) : (
                <p className="py-2 text-center text-xs text-neutral-600">
                  Preview cap reached — download to see the rest
                </p>
              ))}

            {isLongFile && state.kind === "text" && (
              <div className="mt-2 space-y-1">
                <input
                  type="range"
                  min={0}
                  max={maxWindowOffset}
                  value={windowOffset}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                  className="w-full accent-emerald-500"
                  aria-label="Preview window position"
                />
                <p className="text-center text-xs text-neutral-600">
                  {loadingMore
                    ? "Loading…"
                    : `Bytes ${windowOffset.toLocaleString()}–${Math.min(
                        windowOffset + WINDOW_SIZE,
                        fileSize,
                      ).toLocaleString()} of ${fileSize.toLocaleString()}`}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex gap-1 border-t border-neutral-800 p-2">
        <button
          type="button"
          onClick={() => onDownload(entry)}
          className="flex-1 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
        >
          Download
        </button>
        {!runAsPackage && !virtualFs && (
          <>
            <button
              type="button"
              onClick={() => onRename(entry)}
              className="flex-1 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => onDelete(entry)}
              className="flex-1 rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
