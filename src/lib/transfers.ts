import { useTransferStore, type TransferDirection } from "../state/useTransferStore";

// Small/fast transfers complete before a popup would even be useful — only track ones big
// enough that a person watching might wonder if it's actually happening.
const TRACK_THRESHOLD_BYTES = 512 * 1024;
const AUTO_DISMISS_MS = 2000;

/** Wraps an upload/download so it reports progress into the global transfer popup when the
 * file is big enough to warrant one — small transfers just run with no tracking overhead. */
export async function trackTransfer<T>(
  direction: TransferDirection,
  name: string,
  bytesTotal: number,
  run: (onProgress: (bytesDone: number) => void) => Promise<T>,
): Promise<T> {
  const id = bytesTotal >= TRACK_THRESHOLD_BYTES ? crypto.randomUUID() : null;
  if (id) useTransferStore.getState().start(id, name, direction, bytesTotal);

  try {
    const result = await run((bytesDone) => {
      if (id) useTransferStore.getState().progress(id, bytesDone);
    });
    if (id) {
      useTransferStore.getState().finish(id);
      setTimeout(() => useTransferStore.getState().dismiss(id), AUTO_DISMISS_MS);
    }
    return result;
  } catch (err) {
    if (id) {
      useTransferStore.getState().fail(id, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}
