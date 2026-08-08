// Dalvik bytecode instruction walker. Every instruction in a method body must be walked correctly
// — even ones we don't care about — because instructions are variable-length (1-5 16-bit code
// units) and only fully decoding the *previous* instruction tells you where the *next* one
// starts. Opcode -> format assignments below are cross-checked against the canonical table at
// source.android.com/docs/core/runtime/dalvik-bytecode rather than transcribed from memory alone.
//
// Only three instruction shapes are actually decoded beyond "how long is it and which register
// (if any) does it write": const-string / const-string/jumbo, and the non-static invoke-* family
// (virtual/super/direct/interface, plus their /range forms) — see walkInstructions below.
//
// Deliberately conservative: any opcode this table doesn't recognize (a gap in the standard
// range, or anything at/above the "extended ops" boundary — ART-internal quickened opcodes never
// appear in an APK's classes.dex, and newer method-handle/invoke-polymorphic opcodes are rare
// enough in practice, and irrelevant to intent-extra reading, that treating them as "abort this
// method's scan" is the safe choice over guessing a format) causes the whole method to be
// skipped rather than risk silently decoding the rest of it from the wrong position.

type RegisterShape = "none" | "aa" | "a-nibble" | "wide16";

interface OpcodeInfo {
  lengthUnits: number;
  regShape: RegisterShape;
}

const OPCODE_INFO: (OpcodeInfo | undefined)[] = new Array(256);

function fill(startOpcode: number, endOpcodeInclusive: number, lengthUnits: number, regShape: RegisterShape) {
  for (let op = startOpcode; op <= endOpcodeInclusive; op++) {
    OPCODE_INFO[op] = { lengthUnits, regShape };
  }
}

// 0x00 (nop / switch-payload / fill-array-data-payload) is handled specially in walkInstructions,
// never through this table.

// Moves (0x01-0x09): 12x (1 unit, dest = high nibble) for the plain forms, 22x (2 units, dest =
// full high byte) for /from16, 32x (3 units, dest = a full 16-bit register index) for /16.
fill(0x01, 0x01, 1, "a-nibble"); // move
fill(0x02, 0x02, 2, "aa"); // move/from16
fill(0x03, 0x03, 3, "wide16"); // move/16
fill(0x04, 0x04, 1, "a-nibble"); // move-wide
fill(0x05, 0x05, 2, "aa"); // move-wide/from16
fill(0x06, 0x06, 3, "wide16"); // move-wide/16
fill(0x07, 0x07, 1, "a-nibble"); // move-object
fill(0x08, 0x08, 2, "aa"); // move-object/from16
fill(0x09, 0x09, 3, "wide16"); // move-object/16

// move-result*/move-exception (11x, dest = AA), return*/void (11x/10x, no write — over-marking
// AA as "written" for the non-void return forms is a harmless, deliberately conservative choice).
fill(0x0a, 0x0d, 1, "aa"); // move-result, move-result-wide, move-result-object, move-exception
fill(0x0e, 0x0e, 1, "none"); // return-void
fill(0x0f, 0x11, 1, "aa"); // return, return-wide, return-object

// const* (0x12-0x19)
fill(0x12, 0x12, 1, "a-nibble"); // const/4 (11n)
fill(0x13, 0x13, 2, "aa"); // const/16 (21s)
fill(0x14, 0x14, 3, "aa"); // const (31i)
fill(0x15, 0x15, 2, "aa"); // const/high16 (21h)
fill(0x16, 0x16, 2, "aa"); // const-wide/16 (21s)
fill(0x17, 0x17, 3, "aa"); // const-wide/32 (31i)
fill(0x18, 0x18, 5, "aa"); // const-wide (51l)
fill(0x19, 0x19, 2, "aa"); // const-wide/high16 (21h)
// 0x1a/0x1b (const-string, const-string/jumbo) special-cased in walkInstructions.
fill(0x1c, 0x1c, 2, "aa"); // const-class (21c)

fill(0x1d, 0x1e, 1, "aa"); // monitor-enter, monitor-exit (11x, source reg over-marked)
fill(0x1f, 0x1f, 2, "aa"); // check-cast (21c)
fill(0x20, 0x20, 2, "a-nibble"); // instance-of (22c)
fill(0x21, 0x21, 1, "a-nibble"); // array-length (12x)
fill(0x22, 0x22, 2, "aa"); // new-instance (21c)
fill(0x23, 0x23, 2, "a-nibble"); // new-array (22c)
fill(0x24, 0x24, 3, "none"); // filled-new-array (35c, no direct write)
fill(0x25, 0x25, 3, "none"); // filled-new-array/range (3rc)
fill(0x26, 0x26, 3, "aa"); // fill-array-data (31t, source array reg over-marked)
fill(0x27, 0x27, 1, "aa"); // throw (11x, source over-marked)

fill(0x28, 0x28, 1, "none"); // goto (10t)
fill(0x29, 0x29, 2, "none"); // goto/16 (20t)
fill(0x2a, 0x2a, 3, "none"); // goto/32 (30t)
fill(0x2b, 0x2c, 3, "aa"); // packed-switch, sparse-switch (31t, source over-marked)

fill(0x2d, 0x31, 2, "aa"); // cmpl-float..cmp-long (23x)

fill(0x32, 0x37, 2, "a-nibble"); // if-eq..if-le (22t, source regs over-marked)
fill(0x38, 0x3d, 2, "aa"); // if-eqz..if-lez (21t, source over-marked)

// 0x3e-0x43: unused/reserved — left undefined, triggers the safe "abort this method" path.

fill(0x44, 0x51, 2, "aa"); // aget*/aput* (23x)
fill(0x52, 0x5f, 2, "a-nibble"); // iget*/iput* (22c)
fill(0x60, 0x6d, 2, "aa"); // sget*/sput* (21c)

// invoke-{virtual,super,direct,static,interface} (0x6e-0x72, 35c) and their /range forms
// (0x74-0x78, 3rc) are special-cased in walkInstructions for method_idx/arg extraction — table
// entries here exist only so length is correct if reached through any other path.
fill(0x6e, 0x72, 3, "none");
// 0x73: unused/reserved.
fill(0x74, 0x78, 3, "none");
// 0x79-0x7a: unused/reserved.

fill(0x7b, 0x8f, 1, "a-nibble"); // neg-int..int-to-short (12x)
fill(0x90, 0xaf, 2, "aa"); // add-int..rem-double (23x)
fill(0xb0, 0xcf, 1, "a-nibble"); // add-int/2addr..rem-double/2addr (12x)
fill(0xd0, 0xd7, 2, "a-nibble"); // add-int/lit16..xor-int/lit16 (22s)
fill(0xd8, 0xe2, 2, "aa"); // add-int/lit8..ushr-int/lit8 (22b)

// 0xe3 and above: ART-internal "quickened" opcodes (only ever appear in on-device .odex/.oat,
// never in an APK's classes.dex) plus newer, rare method-handle/invoke-polymorphic opcodes —
// intentionally left undefined rather than guessed.

const CONST_STRING = 0x1a;
const CONST_STRING_JUMBO = 0x1b;
const INVOKE_VIRTUAL = 0x6e;
const INVOKE_SUPER = 0x6f;
const INVOKE_DIRECT = 0x70;
const INVOKE_STATIC = 0x71;
const INVOKE_INTERFACE = 0x72;
const INVOKE_VIRTUAL_RANGE = 0x74;
const INVOKE_SUPER_RANGE = 0x75;
const INVOKE_DIRECT_RANGE = 0x76;
const INVOKE_STATIC_RANGE = 0x77;
const INVOKE_INTERFACE_RANGE = 0x78;

function extractRegister(shape: RegisterShape, unit0: number, insns: Uint16Array, pc: number): number | null {
  switch (shape) {
    case "none":
      return null;
    case "aa":
      return (unit0 >> 8) & 0xff;
    case "a-nibble":
      return (unit0 >> 8) & 0xf;
    case "wide16":
      return insns[pc + 1];
  }
}

export interface DecodedInstruction {
  pc: number;
  lengthUnits: number;
  kind: "const-string" | "invoke" | "other";
  /** The register this instruction writes to, for the backward-scan clobber check — `null` when
   * the instruction has no register destination (branches, invokes, literals-only forms). Some
   * entries deliberately over-mark a read-only register as "written" (documented per-opcode
   * above) — always the safe, conservative direction (may cause an unnecessary "unknown key"
   * result, never a wrong one). */
  clobberReg: number | null;
  /** Only set when kind === "const-string". */
  stringIdx?: number;
  /** Only set when kind === "invoke". Logical argument order, receiver first. */
  methodIdx?: number;
  argRegs?: number[];
}

/**
 * Decodes every instruction in a method body, or returns `null` if it hits an opcode outside
 * what this table models, or the decoded lengths don't land exactly on the end of `insns` — both
 * treated as "this one method can't be safely walked," not a hard failure for the whole scan.
 */
export function walkInstructions(insns: Uint16Array): DecodedInstruction[] | null {
  const result: DecodedInstruction[] = [];
  let pc = 0;

  while (pc < insns.length) {
    const unit0 = insns[pc];
    const opcode = unit0 & 0xff;

    if (opcode === 0x00) {
      const sub = (unit0 >> 8) & 0xff;
      if (sub === 0x00) {
        result.push({ pc, lengthUnits: 1, kind: "other", clobberReg: null });
        pc += 1;
        continue;
      }
      if (sub === 0x01) {
        // packed-switch-payload: ident(1) + size(1) + first_key(2) + targets(size*2)
        const size = insns[pc + 1];
        const lengthUnits = 4 + size * 2;
        result.push({ pc, lengthUnits, kind: "other", clobberReg: null });
        pc += lengthUnits;
        continue;
      }
      if (sub === 0x02) {
        // sparse-switch-payload: ident(1) + size(1) + keys(size*2) + targets(size*2)
        const size = insns[pc + 1];
        const lengthUnits = 2 + size * 4;
        result.push({ pc, lengthUnits, kind: "other", clobberReg: null });
        pc += lengthUnits;
        continue;
      }
      if (sub === 0x03) {
        // fill-array-data-payload: ident(1) + element_width(1) + size(2, 32-bit) + data
        const elementWidth = insns[pc + 1];
        const size = (insns[pc + 2] | (insns[pc + 3] << 16)) >>> 0;
        const dataUnits = Math.ceil((size * elementWidth) / 2);
        const lengthUnits = 4 + dataUnits;
        result.push({ pc, lengthUnits, kind: "other", clobberReg: null });
        pc += lengthUnits;
        continue;
      }
      return null; // unrecognized 0x00 sub-opcode
    }

    if (opcode === CONST_STRING) {
      const destReg = (unit0 >> 8) & 0xff;
      const stringIdx = insns[pc + 1];
      result.push({ pc, lengthUnits: 2, kind: "const-string", clobberReg: destReg, stringIdx });
      pc += 2;
      continue;
    }
    if (opcode === CONST_STRING_JUMBO) {
      const destReg = (unit0 >> 8) & 0xff;
      const stringIdx = (insns[pc + 1] | (insns[pc + 2] << 16)) >>> 0;
      result.push({ pc, lengthUnits: 3, kind: "const-string", clobberReg: destReg, stringIdx });
      pc += 3;
      continue;
    }

    if (
      opcode === INVOKE_VIRTUAL ||
      opcode === INVOKE_SUPER ||
      opcode === INVOKE_DIRECT ||
      opcode === INVOKE_INTERFACE
    ) {
      // 35c: unit0 hi byte = A|G (A=arg count 0-5, G=5th arg reg), unit1 = method_idx,
      // unit2 = F|E|D|C (remaining four arg regs). Logical argument order is C,D,E,F,G.
      const argCount = (unit0 >> 12) & 0xf;
      const g = (unit0 >> 8) & 0xf;
      const methodIdx = insns[pc + 1];
      const regsUnit = insns[pc + 2];
      const c = regsUnit & 0xf;
      const d = (regsUnit >> 4) & 0xf;
      const e = (regsUnit >> 8) & 0xf;
      const f = (regsUnit >> 12) & 0xf;
      const argRegs = [c, d, e, f, g].slice(0, argCount);
      result.push({ pc, lengthUnits: 3, kind: "invoke", clobberReg: null, methodIdx, argRegs });
      pc += 3;
      continue;
    }
    if (
      opcode === INVOKE_VIRTUAL_RANGE ||
      opcode === INVOKE_SUPER_RANGE ||
      opcode === INVOKE_DIRECT_RANGE ||
      opcode === INVOKE_INTERFACE_RANGE
    ) {
      // 3rc: unit0 hi byte = AA (full arg count), unit1 = method_idx, unit2 = starting register.
      const argCount = (unit0 >> 8) & 0xff;
      const methodIdx = insns[pc + 1];
      const startReg = insns[pc + 2];
      const argRegs = Array.from({ length: argCount }, (_, i) => startReg + i);
      result.push({ pc, lengthUnits: 3, kind: "invoke", clobberReg: null, methodIdx, argRegs });
      pc += 3;
      continue;
    }
    // invoke-static/invoke-static/range deliberately excluded from "invoke" matching (no real
    // Intent/Bundle getter is static) but still need correct length/no-write handling.
    if (opcode === INVOKE_STATIC || opcode === INVOKE_STATIC_RANGE) {
      result.push({ pc, lengthUnits: 3, kind: "other", clobberReg: null });
      pc += 3;
      continue;
    }

    const info = OPCODE_INFO[opcode];
    if (!info) return null; // unrecognized/gap/too-new opcode — abort this method only
    const clobberReg = extractRegister(info.regShape, unit0, insns, pc);
    result.push({ pc, lengthUnits: info.lengthUnits, kind: "other", clobberReg });
    pc += info.lengthUnits;
  }

  return pc === insns.length ? result : null; // self-check: must land exactly on the end
}
