import { resolveMethod, resolveString, type DexFile } from "./dexHeader";
import { classDefExists, findClassDataOffset, extractMethodCode, resolveSuperclassDescriptor } from "./classData";
import { walkInstructions, type DecodedInstruction } from "./dalvikInstructions";
import type { IntentExtraType } from "../adb/quickLaunch";

const MAX_SUPERCLASS_HOPS = 10;

// Only match getters on these classes — matching by method name alone (getString/getInt/etc.)
// would false-positive constantly against unrelated classes (SharedPreferences, JSON wrappers,
// config objects) that happen to share the same common getter names.
const INTENT_CLASSES = new Set(["Landroid/content/Intent;"]);
const BUNDLE_CLASSES = new Set([
  "Landroid/os/Bundle;",
  "Landroid/os/BaseBundle;",
  "Landroid/os/PersistableBundle;",
]);

/** `Bundle`/`BaseBundle` getters are ambiguous: `onCreate(Bundle savedInstanceState)` produces
 * identical-looking calls that have nothing to do with intent extras, and there's no cheap way
 * to tell them apart without real data-flow tracing of which object the Bundle came from. Kept
 * as a separate, lower-confidence tier rather than merged into the main "intent" results. */
export type ExtraTier = "intent" | "bundle";

function classToTier(classDescriptor: string): ExtraTier | null {
  if (INTENT_CLASSES.has(classDescriptor)) return "intent";
  if (BUNDLE_CLASSES.has(classDescriptor)) return "bundle";
  return null;
}

interface GetterTypeInfo {
  label: string;
  /** `null` when the detected type has no equivalent `am start --e*` flag at all (Parcelable,
   * Serializable, nested Bundle, arrays) — genuinely not launchable from this UI, not just
   * "not implemented yet". */
  editableAs: IntentExtraType | null;
}

const GETTER_TYPES: Record<string, GetterTypeInfo> = {
  getStringExtra: { label: "String", editableAs: "string" },
  getString: { label: "String", editableAs: "string" },
  getCharSequenceExtra: { label: "CharSequence", editableAs: "string" },
  getCharSequence: { label: "CharSequence", editableAs: "string" },
  getBooleanExtra: { label: "Boolean", editableAs: "boolean" },
  getBoolean: { label: "Boolean", editableAs: "boolean" },
  getIntExtra: { label: "Int", editableAs: "int" },
  getInt: { label: "Int", editableAs: "int" },
  getLongExtra: { label: "Long", editableAs: "long" },
  getLong: { label: "Long", editableAs: "long" },
  getFloatExtra: { label: "Float", editableAs: null },
  getFloat: { label: "Float", editableAs: null },
  getDoubleExtra: { label: "Double", editableAs: null },
  getDouble: { label: "Double", editableAs: null },
  getByteExtra: { label: "Byte", editableAs: null },
  getByte: { label: "Byte", editableAs: null },
  getShortExtra: { label: "Short", editableAs: null },
  getShort: { label: "Short", editableAs: null },
  getCharExtra: { label: "Char", editableAs: null },
  getChar: { label: "Char", editableAs: null },
  getParcelableExtra: { label: "Parcelable", editableAs: null },
  getParcelable: { label: "Parcelable", editableAs: null },
  getParcelableArrayExtra: { label: "Parcelable[]", editableAs: null },
  getParcelableArrayListExtra: { label: "Parcelable ArrayList", editableAs: null },
  getSerializableExtra: { label: "Serializable", editableAs: null },
  getSerializable: { label: "Serializable", editableAs: null },
  getBundleExtra: { label: "Bundle", editableAs: null },
  getBundle: { label: "Bundle", editableAs: null },
  getStringArrayExtra: { label: "String[]", editableAs: null },
  getStringArrayListExtra: { label: "String ArrayList", editableAs: null },
  getIntArrayExtra: { label: "int[]", editableAs: null },
  getIntegerArrayListExtra: { label: "Integer ArrayList", editableAs: null },
  getLongArrayExtra: { label: "long[]", editableAs: null },
  getFloatArrayExtra: { label: "float[]", editableAs: null },
  getDoubleArrayExtra: { label: "double[]", editableAs: null },
  getBooleanArrayExtra: { label: "boolean[]", editableAs: null },
  getByteArrayExtra: { label: "byte[]", editableAs: null },
  getShortArrayExtra: { label: "short[]", editableAs: null },
  getCharArrayExtra: { label: "char[]", editableAs: null },
};

export interface DetectedExtra {
  key: string | null;
  confidence: "high" | "unknown-key";
  methodName: string;
  detectedType: string;
  editableAs: IntentExtraType | null;
  tier: ExtraTier;
}

/**
 * Scans backward from a matched getter call for the most recent write to its key-argument
 * register. A `const-string` write is a confident match. Any *other* write to that register
 * first means the live value at the call site can't be traced this simply — reported as
 * "unknown key" rather than guessed. Deliberately biased toward false negatives over false
 * positives: never returns a key it isn't sure about.
 */
function backwardScanForKey(
  dex: DexFile,
  decoded: DecodedInstruction[],
  invokeIndex: number,
  keyReg: number,
): { key: string | null; confidence: "high" | "unknown-key" } {
  for (let j = invokeIndex - 1; j >= 0; j--) {
    const instr = decoded[j];
    if (instr.clobberReg !== keyReg) continue;
    if (instr.kind === "const-string" && instr.stringIdx !== undefined) {
      return { key: resolveString(dex, instr.stringIdx), confidence: "high" };
    }
    return { key: null, confidence: "unknown-key" };
  }
  return { key: null, confidence: "unknown-key" };
}

function scanMethodForExtras(dex: DexFile, insns: Uint16Array): DetectedExtra[] {
  const decoded = walkInstructions(insns);
  if (!decoded) return []; // unwalkable method (unrecognized opcode, desync) — skip, don't guess

  const results: DetectedExtra[] = [];
  for (let i = 0; i < decoded.length; i++) {
    const instr = decoded[i];
    if (instr.kind !== "invoke" || instr.methodIdx === undefined || !instr.argRegs) continue;
    if (instr.argRegs.length < 2) continue; // no key argument (e.g. bare getExtras())

    const resolved = resolveMethod(dex, instr.methodIdx);
    const tier = classToTier(resolved.classDescriptor);
    if (!tier) continue;
    const typeInfo = GETTER_TYPES[resolved.name];
    if (!typeInfo) continue;

    const keyReg = instr.argRegs[1]; // arg0 is the implicit receiver; the key is always arg1
    const { key, confidence } = backwardScanForKey(dex, decoded, i, keyReg);

    results.push({
      key,
      confidence,
      methodName: resolved.name,
      detectedType: typeInfo.label,
      editableAs: typeInfo.editableAs,
      tier,
    });
  }
  return results;
}

/** Scans one class's own direct + virtual methods (not superclasses, not other classes it calls
 * into — see the module-level design notes) for Intent/Bundle getter call sites. */
export function scanClassForExtras(dex: DexFile, descriptor: string): DetectedExtra[] {
  const classDataOff = findClassDataOffset(dex, descriptor);
  if (!classDataOff) return [];

  const seen = new Set<string>();
  const results: DetectedExtra[] = [];
  for (const method of extractMethodCode(dex, classDataOff)) {
    for (const extra of scanMethodForExtras(dex, method.insns)) {
      const dedupeKey = `${extra.tier}|${extra.methodName}|${extra.key ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push(extra);
    }
  }
  return results;
}

/**
 * Scans a class *and its superclass chain* (within the given dex set — never following into the
 * Android framework/Java standard library itself, which isn't present in the app's own dex
 * files anyway). Many real activities/services/receivers read their extras entirely inside a
 * shared `BaseActivity.onCreate()` rather than their own class — same-class-only scanning misses
 * this extremely common pattern, so this is the default entry point rather than
 * `scanClassForExtras` alone. Bounded to a small number of hops as a defensive guard against a
 * malformed/cyclic superclass reference.
 */
export function scanClassHierarchyForExtras(dexFiles: DexFile[], descriptor: string): DetectedExtra[] {
  const results: DetectedExtra[] = [];
  const seen = new Set<string>();
  let currentDescriptor: string | null = descriptor;

  for (let hops = 0; currentDescriptor && hops < MAX_SUPERCLASS_HOPS; hops++) {
    const target = currentDescriptor;
    if (target.startsWith("Landroid/") || target.startsWith("Ljava/")) break;

    const dexForClass = dexFiles.find((dex) => classDefExists(dex, target));
    if (!dexForClass) break;

    for (const extra of scanClassForExtras(dexForClass, target)) {
      const dedupeKey = `${extra.tier}|${extra.methodName}|${extra.key ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push(extra);
    }

    currentDescriptor = resolveSuperclassDescriptor(dexForClass, target);
  }

  return results;
}
