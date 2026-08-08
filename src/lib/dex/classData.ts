import { readUleb128, resolveTypeDescriptor, type DexFile } from "./dexHeader";

export interface MethodCode {
  methodIdx: number;
  insns: Uint16Array;
}

/** Whether this dex file defines the class at all — independent of whether it has any
 * fields/methods — so callers can distinguish "not in this dex, try the next one" from "found,
 * but a scan of it turned up nothing". */
export function classDefExists(dex: DexFile, descriptor: string): boolean {
  for (let i = 0; i < dex.classDefsSize; i++) {
    const classIdx = dex.view.getUint32(dex.classDefsOff + i * 32, true);
    if (resolveTypeDescriptor(dex, classIdx) === descriptor) return true;
  }
  return false;
}

const NO_INDEX = 0xffffffff; // DEX sentinel: "no value" (e.g. java.lang.Object has no superclass)

/** Resolves a class's declared superclass descriptor, or `null` if it has none (`Object`) or
 * this dex doesn't define the class at all. Used to widen a scan up the class hierarchy — many
 * real activities/services/receivers read their extras in a shared base class's lifecycle
 * method, not their own. */
export function resolveSuperclassDescriptor(dex: DexFile, descriptor: string): string | null {
  for (let i = 0; i < dex.classDefsSize; i++) {
    const base = dex.classDefsOff + i * 32;
    const classIdx = dex.view.getUint32(base, true);
    if (resolveTypeDescriptor(dex, classIdx) !== descriptor) continue;
    const superclassIdx = dex.view.getUint32(base + 8, true); // 3rd field of class_def_item
    return superclassIdx === NO_INDEX ? null : resolveTypeDescriptor(dex, superclassIdx);
  }
  return null;
}

/** Finds a `class_def_item`'s `class_data_off` by descriptor (e.g. `Lcom/example/Foo;`), or
 * `null` if the class isn't defined in this dex file (multidex — try the next one) or has no
 * fields/methods at all (a marker interface or pure-constant class). */
export function findClassDataOffset(dex: DexFile, descriptor: string): number | null {
  for (let i = 0; i < dex.classDefsSize; i++) {
    const base = dex.classDefsOff + i * 32;
    const classIdx = dex.view.getUint32(base, true);
    if (resolveTypeDescriptor(dex, classIdx) !== descriptor) continue;
    const classDataOff = dex.view.getUint32(base + 24, true); // 7th field of class_def_item
    return classDataOff || null;
  }
  return null;
}

// code_item header is a fixed 16 bytes: registers_size(u16), ins_size(u16), outs_size(u16),
// tries_size(u16), debug_info_off(u32), insns_size(u32) — followed immediately by
// insns_size * u16 code units. Anything after that (try/catch tables) is irrelevant here and
// deliberately never read.
function readCodeItemInsns(dex: DexFile, codeOff: number): Uint16Array | null {
  const insnsSize = dex.view.getUint32(codeOff + 12, true);
  const insnsStart = codeOff + 16;
  if (insnsStart + insnsSize * 2 > dex.bytes.length) return null;
  // Copied unit-by-unit rather than viewed directly over the buffer: a `Uint16Array` requires a
  // 2-byte-aligned offset (this one often isn't) and reads in platform-native endianness, whereas
  // DEX is always little-endian regardless of platform.
  const insns = new Uint16Array(insnsSize);
  for (let i = 0; i < insnsSize; i++) {
    insns[i] = dex.view.getUint16(insnsStart + i * 2, true);
  }
  return insns;
}

/**
 * Walks a `class_data_item` to extract every direct/virtual method's bytecode. Field entries are
 * read (as ULEB128 pairs) purely to advance past them correctly — their content is never used.
 * `method_idx` is delta-encoded and cumulative *within* each of the direct/virtual sections
 * independently (the running total resets when virtual_methods begins).
 */
export function extractMethodCode(dex: DexFile, classDataOff: number | null): MethodCode[] {
  if (!classDataOff) return [];
  const bytes = dex.bytes;
  let pos = classDataOff;

  const staticFieldsSize = readUleb128(bytes, pos);
  pos = staticFieldsSize.nextOffset;
  const instanceFieldsSize = readUleb128(bytes, pos);
  pos = instanceFieldsSize.nextOffset;
  const directMethodsSize = readUleb128(bytes, pos);
  pos = directMethodsSize.nextOffset;
  const virtualMethodsSize = readUleb128(bytes, pos);
  pos = virtualMethodsSize.nextOffset;

  const totalFields = staticFieldsSize.value + instanceFieldsSize.value;
  for (let i = 0; i < totalFields; i++) {
    pos = readUleb128(bytes, pos).nextOffset; // field_idx_diff
    pos = readUleb128(bytes, pos).nextOffset; // access_flags
  }

  const methods: MethodCode[] = [];
  const totalMethods = directMethodsSize.value + virtualMethodsSize.value;
  let methodIdx = 0;
  for (let i = 0; i < totalMethods; i++) {
    if (i === directMethodsSize.value) methodIdx = 0; // reset at the start of virtual_methods

    const diff = readUleb128(bytes, pos);
    pos = diff.nextOffset;
    pos = readUleb128(bytes, pos).nextOffset; // access_flags, unused
    const codeOff = readUleb128(bytes, pos);
    pos = codeOff.nextOffset;

    methodIdx += diff.value;

    if (codeOff.value !== 0) {
      const insns = readCodeItemInsns(dex, codeOff.value);
      if (insns) methods.push({ methodIdx, insns });
    }
  }
  return methods;
}
