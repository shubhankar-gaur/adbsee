import { useRef, useState, type DragEvent } from "react";
import type { AdbSyncEntry } from "@yume-chan/adb";

// Dragging a file out to the OS desktop (Chromium's `DownloadURL` dataTransfer trick) needs the
// bytes to already be sitting in a blob: URL the instant the drag starts — the Drag and Drop API
// has no way to attach data asynchronously after dragstart fires, and our reads are inherently
// async (a USB round-trip). The workaround: speculatively fetch on hover, and only allow the
// drag once that fetch has actually landed — small/medium files usually finish before a person
// goes from "hovering" to "actually dragging"; anything not ready yet just isn't draggable yet.
const PREFETCH_MAX_BYTES = 10 * 1024 * 1024;
const REVOKE_DELAY_MS = 5000;

export function useDragToDownload(
  entry: AdbSyncEntry,
  fetchBlob: (entry: AdbSyncEntry) => Promise<Blob>,
) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const fetchingRef = useRef(false);

  const handleMouseEnter = () => {
    if (blob || fetchingRef.current || entry.size > PREFETCH_MAX_BYTES) return;
    fetchingRef.current = true;
    fetchBlob(entry)
      .then(setBlob)
      .catch(() => {
        // Best-effort — if it fails, dragging just stays unavailable for this file.
      })
      .finally(() => {
        fetchingRef.current = false;
      });
  };

  const handleDragStart = (e: DragEvent) => {
    if (!blob) {
      e.preventDefault();
      return;
    }
    const url = URL.createObjectURL(blob);
    const mime = blob.type || "application/octet-stream";
    e.dataTransfer.setData("DownloadURL", `${mime}:${entry.name}:${url}`);
    e.dataTransfer.effectAllowed = "copy";
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
  };

  return {
    draggable: blob !== null,
    onMouseEnter: handleMouseEnter,
    onDragStart: handleDragStart,
  };
}
