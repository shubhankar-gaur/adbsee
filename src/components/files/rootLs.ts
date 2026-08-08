import { LinuxFileType, type AdbSyncEntry } from "@yume-chan/adb";

const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;

const LS_LINE = /^([bcdlpsD-])([-rwxstST]{9})\s+\d+\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/;

function permBitsFromString(perm: string): number {
  let bits = 0;
  for (let i = 0; i < 9 && i < perm.length; i++) {
    if (perm[i] !== "-") bits |= 1 << (8 - i);
  }
  return bits;
}

function typeFromChar(typeChar: string): LinuxFileType {
  if (typeChar === "d") return LinuxFileType.Directory;
  if (typeChar === "l") return LinuxFileType.Link;
  return LinuxFileType.File;
}

function modeFor(type: LinuxFileType, permission: number): number {
  const typeBits = type === LinuxFileType.Directory ? S_IFDIR : type === LinuxFileType.Link ? S_IFLNK : S_IFREG;
  return typeBits | permission;
}

/**
 * Parses `ls -la` output (from `su -c ls -la <path>`) into `AdbSyncEntry`-compatible objects, for
 * browsing paths the unprivileged sync connection can't reach. Best-effort: `ls`'s exact date
 * format varies enough across Android/toybox versions that mtime falls back to a `0n` sentinel
 * (rendered as "—") when it doesn't parse as a real date, rather than risk showing a wrong time.
 */
export function parseRootLsOutput(output: string): AdbSyncEntry[] {
  const entries: AdbSyncEntry[] = [];

  for (const line of output.split("\n")) {
    const match = LS_LINE.exec(line.trimEnd());
    if (!match) continue;

    const [, typeChar, permString, , , sizeStr, date, time, rawName] = match;
    const type = typeFromChar(typeChar);
    const name = type === LinuxFileType.Link ? rawName.split(" -> ")[0] : rawName;
    if (name === "." || name === "..") continue;

    const permission = permBitsFromString(permString);
    const parsedTime = Date.parse(`${date} ${time}`);
    const mtime = Number.isNaN(parsedTime) ? 0n : BigInt(Math.floor(parsedTime / 1000));

    entries.push({
      name,
      type,
      permission,
      size: BigInt(sizeStr),
      mtime,
      mode: modeFor(type, permission),
    });
  }

  return entries;
}
