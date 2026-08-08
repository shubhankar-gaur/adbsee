import type { Adb } from "@yume-chan/adb";
import { suCommand } from "./suCommand";

/**
 * Checks whether `su` is present and will actually grant root when adbd asks for it — not just
 * that the binary exists. Devices vary in whether root has to be interactively approved
 * (Magisk's superuser prompt) the first time; this call is what would trigger that prompt.
 */
export async function checkRootAccess(adb: Adb): Promise<boolean> {
  try {
    const output = await adb.subprocess.noneProtocol.spawnWaitText(suCommand(["id"]));
    return /\buid=0\b/.test(output);
  } catch {
    return false;
  }
}
