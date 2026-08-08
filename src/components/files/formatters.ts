import { LinuxFileType } from "@yume-chan/adb";

export function formatSize(size: bigint): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(size);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/** `0n` is used as a sentinel for "unavailable" (e.g. a root-mode `ls` listing whose date format
 * didn't parse) rather than a real epoch-zero mtime, which essentially never occurs in practice. */
export function formatMtime(mtime: bigint): string {
  if (mtime === 0n) return "—";
  return new Date(Number(mtime) * 1000).toLocaleString();
}

export function formatPermissions(permission: number): string {
  const chars = "xwr";
  let result = "";
  for (const shift of [6, 3, 0]) {
    for (let bit = 2; bit >= 0; bit--) {
      result += permission & (1 << (shift + bit)) ? chars[bit] : "-";
    }
  }
  return result;
}

export function typeIcon(type: LinuxFileType): string {
  switch (type) {
    case LinuxFileType.Directory:
      return "\u{1F4C1}";
    case LinuxFileType.Link:
      return "\u{1F517}";
    default:
      return "\u{1F4C4}";
  }
}
