import { LinuxFileType, type AdbSyncEntry } from "@yume-chan/adb";
import { typeIcon } from "./formatters";
import { joinPath } from "./pathUtils";
import { useDragToDownload } from "./useDragToDownload";

export interface FileGridProps {
  entries: AdbSyncEntry[];
  mode: "icons" | "thumbnails";
  thumbnails: Map<string, string>;
  currentPath: string;
  onOpen: (entry: AdbSyncEntry) => void;
  fetchBlob: (entry: AdbSyncEntry) => Promise<Blob>;
}

function FileGridTile({
  entry,
  thumbnailUrl,
  onOpen,
  fetchBlob,
}: {
  entry: AdbSyncEntry;
  thumbnailUrl: string | undefined;
  onOpen: (entry: AdbSyncEntry) => void;
  fetchBlob: (entry: AdbSyncEntry) => Promise<Blob>;
}) {
  const isDir = entry.type === LinuxFileType.Directory;
  const drag = useDragToDownload(entry, fetchBlob);

  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      {...(isDir ? {} : drag)}
      title={!isDir && drag.draggable ? "Drag to your desktop to download" : undefined}
      className={`flex flex-col items-center gap-1 rounded p-2 text-center hover:bg-neutral-900 ${
        !isDir && drag.draggable ? "cursor-grab" : ""
      }`}
    >
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt="" className="h-16 w-16 rounded object-cover" />
      ) : (
        <span className="text-4xl">{typeIcon(entry.type)}</span>
      )}
      <span
        className={`w-full truncate text-xs ${isDir ? "text-neutral-100" : "text-neutral-300"}`}
      >
        {entry.name}
      </span>
    </button>
  );
}

export function FileGrid({ entries, mode, thumbnails, currentPath, onOpen, fetchBlob }: FileGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3 p-3">
      {entries.map((entry) => (
        <FileGridTile
          key={entry.name}
          entry={entry}
          thumbnailUrl={
            mode === "thumbnails" ? thumbnails.get(joinPath(currentPath, entry.name)) : undefined
          }
          onOpen={onOpen}
          fetchBlob={fetchBlob}
        />
      ))}
    </div>
  );
}
