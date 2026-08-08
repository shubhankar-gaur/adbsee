// Byte-level DEX (Dalvik Executable) parsing — header + string/type/method pool resolution.
// Deliberately doesn't touch proto_ids or field_ids: this scanner never needs a method's declared
// parameter types (the getter's *name* alone determines the type label, and the key-argument
// register position comes from the invoke instruction's own encoding, not the proto — see
// extraKeyScanner.ts) or field references at all.

export interface DexFile {
  bytes: Uint8Array;
  view: DataView;
  stringIdsOff: number;
  stringIdsSize: number;
  typeIdsOff: number;
  typeIdsSize: number;
  methodIdsOff: number;
  methodIdsSize: number;
  classDefsOff: number;
  classDefsSize: number;
}

const HEADER_SIZE = 0x70;
const ENDIAN_TAG = 0x12345678;
const NUL = String.fromCharCode(0);

export function parseDexHeader(bytes: Uint8Array): DexFile {
  if (bytes.length < HEADER_SIZE) throw new Error("Not a DEX file (too short)");
  // "dex\n" + version + trailing NUL, e.g. "dex\n035\0" — only the fixed 4-byte prefix is checked.
  if (bytes[0] !== 0x64 || bytes[1] !== 0x65 || bytes[2] !== 0x78 || bytes[3] !== 0x0a) {
    throw new Error("Not a DEX file (bad magic)");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(40, true) !== ENDIAN_TAG) {
    throw new Error("Unsupported DEX endianness");
  }
  return {
    bytes,
    view,
    stringIdsSize: view.getUint32(56, true),
    stringIdsOff: view.getUint32(60, true),
    typeIdsSize: view.getUint32(64, true),
    typeIdsOff: view.getUint32(68, true),
    methodIdsSize: view.getUint32(88, true),
    methodIdsOff: view.getUint32(92, true),
    classDefsSize: view.getUint32(96, true),
    classDefsOff: view.getUint32(100, true),
  };
}

export interface Uleb128Result {
  value: number;
  nextOffset: number;
}

export function readUleb128(bytes: Uint8Array, offset: number): Uleb128Result {
  let result = 0;
  let shift = 0;
  let pos = offset;
  let byte: number;
  do {
    byte = bytes[pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return { value: result >>> 0, nextOffset: pos };
}

/**
 * Decodes a DEX string_data_item: a ULEB128 UTF-16-length prefix (unused here — the byte
 * sequence itself is NUL-terminated, which is enough) followed by MUTF-8 bytes. MUTF-8 differs
 * from standard UTF-8 in two ways real DEX strings can actually exercise: NUL is encoded as the
 * overlong two-byte sequence `0xC0 0x80` (since a raw 0x00 byte is the terminator), and
 * supplementary characters are encoded as two independent 3-byte sequences — one per UTF-16
 * surrogate half — rather than one 4-byte sequence. Emitting each decoded UTF-16 code unit
 * independently is sufficient: JS strings are UTF-16-based, so a correctly-ordered surrogate pair
 * reconstitutes on its own with no extra work.
 */
export function decodeMutf8String(bytes: Uint8Array, dataOffset: number): string {
  const { nextOffset } = readUleb128(bytes, dataOffset);
  let pos = nextOffset;
  let out = "";
  for (;;) {
    const b0 = bytes[pos];
    if (b0 === undefined || b0 === 0x00) break;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      pos += 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      const b1 = bytes[pos + 1] ?? 0;
      if (b0 === 0xc0 && b1 === 0x80) {
        out += NUL;
      } else {
        out += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
      }
      pos += 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      const b1 = bytes[pos + 1] ?? 0;
      const b2 = bytes[pos + 2] ?? 0;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f));
      pos += 3;
    } else {
      // Not valid MUTF-8 (real 4-byte sequences never appear) — skip defensively rather than
      // looping forever or throwing over a single malformed string.
      pos += 1;
    }
  }
  return out;
}

export function resolveString(dex: DexFile, stringIdx: number): string {
  const stringDataOff = dex.view.getUint32(dex.stringIdsOff + stringIdx * 4, true);
  return decodeMutf8String(dex.bytes, stringDataOff);
}

export function resolveTypeDescriptor(dex: DexFile, typeIdx: number): string {
  const descriptorIdx = dex.view.getUint32(dex.typeIdsOff + typeIdx * 4, true);
  return resolveString(dex, descriptorIdx);
}

export interface ResolvedMethod {
  classDescriptor: string;
  name: string;
}

export function resolveMethod(dex: DexFile, methodIdx: number): ResolvedMethod {
  const base = dex.methodIdsOff + methodIdx * 8;
  const classIdx = dex.view.getUint16(base, true);
  // proto_idx lives at base+2 — intentionally unused, see file header comment.
  const nameIdx = dex.view.getUint32(base + 4, true);
  return { classDescriptor: resolveTypeDescriptor(dex, classIdx), name: resolveString(dex, nameIdx) };
}

/** Converts a dumpsys-style `pkg/.RelativeClass` or `pkg/full.Class` component token into the DEX
 * type descriptor (`Lpkg/full/Class;`) needed to match against `class_def_item`s. */
export function componentToDescriptor(component: string): string {
  const slash = component.indexOf("/");
  const pkg = component.slice(0, slash);
  const suffix = component.slice(slash + 1);
  const fullyQualified = suffix.startsWith(".")
    ? pkg + suffix
    : suffix.includes(".")
      ? suffix
      : `${pkg}.${suffix}`;
  return `L${fullyQualified.replace(/\./g, "/")};`;
}
