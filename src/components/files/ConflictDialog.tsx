import { useEffect, useState } from "react";
import { useConflictDialogStore } from "../../state/useConflictDialogStore";

export function ConflictDialog() {
  const pending = useConflictDialogStore((s) => s.pending);
  const resolve = useConflictDialogStore((s) => s.resolve);
  const [renameTo, setRenameTo] = useState("");

  useEffect(() => {
    setRenameTo(pending?.suggestedName ?? "");
  }, [pending]);

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-96 rounded border border-neutral-700 bg-neutral-900 p-4 shadow-xl">
        <p className="text-sm text-neutral-200">
          <span className="font-mono text-neutral-100">{pending.fileName}</span> already exists in
          this folder.
        </p>

        <div className="mt-4 flex items-center gap-2">
          <input
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200"
          />
          <button
            type="button"
            onClick={() => resolve({ action: "rename", name: renameTo })}
            disabled={!renameTo.trim()}
            className="shrink-0 rounded bg-emerald-500 px-3 py-1 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
          >
            Rename
          </button>
        </div>

        <div className="mt-4 flex justify-end gap-2 text-sm">
          <button
            type="button"
            onClick={() => resolve({ action: "skip" })}
            className="rounded border border-neutral-700 px-3 py-1 text-neutral-300 hover:bg-neutral-800"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => resolve({ action: "replace" })}
            className="rounded border border-red-900 px-3 py-1 text-red-300 hover:bg-red-950"
          >
            Replace
          </button>
        </div>
      </div>
    </div>
  );
}
