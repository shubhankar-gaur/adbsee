import { useTransferStore } from "../../state/useTransferStore";

function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function TransferToastStack() {
  const transfers = useTransferStore((s) => s.transfers);
  const dismiss = useTransferStore((s) => s.dismiss);

  if (transfers.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {transfers.map((t) => {
        const percent = t.bytesTotal > 0 ? Math.min(100, (t.bytesDone / t.bytesTotal) * 100) : 0;
        return (
          <div
            key={t.id}
            className="pointer-events-auto w-72 rounded border border-neutral-800 bg-neutral-900 p-3 shadow-lg"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-neutral-200">
                {t.direction === "upload" ? "Uploading" : "Downloading"} {t.name}
              </span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 text-neutral-500 hover:text-neutral-200"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
            {t.status === "error" ? (
              <p className="mt-1 text-xs text-red-300">{t.error}</p>
            ) : (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width]"
                    style={{ width: `${t.status === "done" ? 100 : percent}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  {t.status === "done"
                    ? "Done"
                    : `${formatBytes(t.bytesDone)} / ${formatBytes(t.bytesTotal)} (${percent.toFixed(0)}%)`}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
