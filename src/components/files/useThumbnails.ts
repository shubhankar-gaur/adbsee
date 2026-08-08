import { useEffect, useRef, useState } from "react";
import type { Adb, AdbSyncEntry } from "@yume-chan/adb";
import { readFileFull, readFileRootFull } from "../../lib/adb/readFile";
import { isImageFile, joinPath } from "./pathUtils";
import type { SyncQueue } from "./syncQueue";

const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 200;

/**
 * Fetches and caches image thumbnails, keyed by absolute device path so navigating away and
 * back (or toggling view modes) never re-fetches. Only runs while `active` (Thumbnails view).
 */
export function useThumbnails(
  adb: Adb | null,
  queue: SyncQueue,
  currentPath: string,
  entries: AdbSyncEntry[],
  active: boolean,
  rootMode: boolean,
): Map<string, string> {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const inFlightRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  // Every object URL ever created, independent of the `thumbnails` state map (which can evict
  // entries) — this is what actually gets revoked on unmount, so it can't go stale the way a
  // `[]`-effect's closure over `thumbnails` would (that bug meant real URLs were never revoked).
  const allUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Runs on every (re)mount, including React StrictMode's dev-only mount→cleanup→mount dance —
    // without this, mountedRef would stay `false` forever after the simulated cleanup below and
    // every fetch's `if (!mountedRef.current) return;` would silently discard its result.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const url of allUrlsRef.current) URL.revokeObjectURL(url);
      allUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!adb || !active) return;

    for (const entry of entries) {
      if (!isImageFile(entry.name) || entry.size > THUMBNAIL_MAX_BYTES) continue;
      const path = joinPath(currentPath, entry.name);
      if (thumbnails.has(path) || inFlightRef.current.has(path)) continue;

      inFlightRef.current.add(path);
      void queue
        .run(() => (rootMode ? readFileRootFull(adb, path) : readFileFull(adb, path)))
        .then((bytes) => {
          inFlightRef.current.delete(path);
          if (!mountedRef.current) return;
          const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
          allUrlsRef.current.add(url);
          setThumbnails((prev) => {
            const next = new Map(prev);
            next.set(path, url);
            if (next.size > MAX_CACHE_ENTRIES) {
              const oldestKey = next.keys().next().value;
              if (oldestKey !== undefined) {
                const oldestUrl = next.get(oldestKey);
                if (oldestUrl) {
                  URL.revokeObjectURL(oldestUrl);
                  allUrlsRef.current.delete(oldestUrl);
                }
                next.delete(oldestKey);
              }
            }
            return next;
          });
        })
        .catch(() => {
          inFlightRef.current.delete(path);
        });
    }
    // Deliberately excludes `thumbnails` — it's read for its current value at fetch-start time,
    // not something that should retrigger this effect (that would just be a harmless no-op pass,
    // but an unnecessary one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adb, active, currentPath, entries, queue, rootMode]);

  return thumbnails;
}
