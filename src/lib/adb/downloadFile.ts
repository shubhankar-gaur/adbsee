import type { Adb } from "@yume-chan/adb";
import { downloadBlob } from "../downloadBlob";
import { readFileFull } from "./readFile";

export async function downloadFile(
  adb: Adb,
  remotePath: string,
  filename: string,
  onProgress?: (bytesRead: number) => void,
): Promise<void> {
  const bytes = await readFileFull(adb, remotePath, onProgress);
  downloadBlob(new Blob([bytes as BlobPart]), filename);
}
