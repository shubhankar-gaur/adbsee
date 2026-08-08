import type { Adb } from "@yume-chan/adb";

/** `exec:` (what noneProtocol uses) has no PTY, so stdout is already binary-safe here. */
export async function takeScreenshot(adb: Adb): Promise<Blob> {
  const bytes = await adb.subprocess.noneProtocol.spawnWait(["screencap", "-p"]);
  return new Blob([bytes as BlobPart], { type: "image/png" });
}
