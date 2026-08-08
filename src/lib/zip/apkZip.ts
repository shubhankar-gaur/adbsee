import { inflateSync } from "fflate";

// Hand-rolled central-directory ZIP reader — an APK is just a ZIP, and this only needs to find
// and extract a handful of named entries (classes*.dex), not general-purpose zip handling, so a
// full zip library would be overkill. Only compression methods 0 (stored) and 8 (deflate) are
// supported, and zip64 isn't handled — both are safe assumptions for real-world APKs.

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_FIXED_SIZE = 22;
const MAX_COMMENT_LENGTH = 0xffff;

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}
function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

// EOCD sits at the very end of the file, optionally followed by a comment (max 64KB) — scan
// backward from the end for its signature rather than assuming a fixed position.
function findEndOfCentralDirectory(view: DataView): number {
  const maxScan = Math.min(view.byteLength, MAX_COMMENT_LENGTH + EOCD_FIXED_SIZE);
  const earliest = view.byteLength - maxScan;
  for (let offset = view.byteLength - EOCD_FIXED_SIZE; offset >= earliest; offset--) {
    if (u32(view, offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("Not a valid ZIP file: end-of-central-directory record not found");
}

const textDecoder = new TextDecoder("utf-8");

export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const totalEntries = u16(view, eocdOffset + 10);
  let offset = u32(view, eocdOffset + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < totalEntries; i++) {
    if (u32(view, offset) !== CENTRAL_DIR_SIGNATURE) break;
    const compressionMethod = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localHeaderOffset = u32(view, offset + 42);
    const name = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function extractZipEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (u32(view, entry.localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`Corrupt local file header for "${entry.name}"`);
  }
  // The central directory (not the local header) is the source of truth for compression
  // method/size — a local header can have these zeroed out when a trailing "data descriptor" is
  // used instead. The local header is only needed to find where the compressed data actually
  // starts, since its name/extra-field lengths can in principle differ from the central copy.
  const nameLength = u16(view, entry.localHeaderOffset + 26);
  const extraLength = u16(view, entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return inflateSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for "${entry.name}"`);
}

function dexIndex(name: string): number {
  // "classes.dex" is conventionally the first/primary dex; "classes2.dex", "classes3.dex", ...
  // follow for multidex apps.
  const match = /^classes(\d*)\.dex$/.exec(name);
  const suffix = match?.[1];
  return suffix ? parseInt(suffix, 10) : 1;
}

/** Enumerates and extracts every `classes*.dex` entry in an APK, in load order, for multidex
 * support (a class is only ever defined in exactly one of them). */
export function extractDexFiles(apkBytes: Uint8Array): Uint8Array[] {
  const dexEntries = listZipEntries(apkBytes)
    .filter((entry) => /^classes\d*\.dex$/.test(entry.name))
    .sort((a, b) => dexIndex(a.name) - dexIndex(b.name));
  return dexEntries.map((entry) => extractZipEntry(apkBytes, entry));
}
