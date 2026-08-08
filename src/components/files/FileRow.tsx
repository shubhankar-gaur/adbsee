import { LinuxFileType, type AdbSyncEntry } from "@yume-chan/adb";
import { formatSize, formatMtime, formatPermissions, typeIcon } from "./formatters";
import { useDragToDownload } from "./useDragToDownload";

export interface FileRowProps {
  entry: AdbSyncEntry;
  onOpen: (entry: AdbSyncEntry) => void;
  onDownload: (entry: AdbSyncEntry) => void;
  onRename: (entry: AdbSyncEntry) => void;
  onDelete: (entry: AdbSyncEntry) => void;
  fetchBlob: (entry: AdbSyncEntry) => Promise<Blob>;
  /** True while browsing via `run-as` — write operations aren't wired up for that mode. */
  readOnly?: boolean;
}

export function FileRow({
  entry,
  onOpen,
  onDownload,
  onRename,
  onDelete,
  fetchBlob,
  readOnly,
}: FileRowProps) {
  const isDir = entry.type === LinuxFileType.Directory;
  const drag = useDragToDownload(entry, fetchBlob);

  return (
    <div
      {...(isDir ? {} : drag)}
      title={!isDir && drag.draggable ? "Drag to your desktop to download" : undefined}
      className={`group flex items-center gap-3 border-b border-neutral-900 px-3 py-1.5 text-sm hover:bg-neutral-900 ${
        !isDir && drag.draggable ? "cursor-grab" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
          isDir ? "text-neutral-100" : "text-neutral-300"
        } cursor-pointer`}
      >
        <span>{typeIcon(entry.type)}</span>
        <span className="truncate">{entry.name}</span>
      </button>
      <span className="w-20 shrink-0 text-right text-neutral-500">
        {isDir ? "" : formatSize(entry.size)}
      </span>
      <span className="w-40 shrink-0 text-neutral-500">{formatMtime(entry.mtime)}</span>
      <span className="w-20 shrink-0 font-mono text-neutral-600">
        {formatPermissions(entry.permission)}
      </span>
      <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100">
        {!isDir && (
          <button
            type="button"
            onClick={() => onDownload(entry)}
            className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Download
          </button>
        )}
        {!readOnly && (
          <>
            <button
              type="button"
              onClick={() => onRename(entry)}
              className="rounded border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => onDelete(entry)}
              className="rounded border border-red-900 px-1.5 py-0.5 text-xs text-red-300 hover:bg-red-950"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
