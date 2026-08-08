// `.subarray()`/`concat` results and a plain `new Uint8Array(n)` are different generic
// instantiations (`ArrayBufferLike` vs `ArrayBuffer`) under TS's typed-array types; using the
// looser form consistently avoids fighting that mismatch throughout this file.
type Bytes = Uint8Array<ArrayBufferLike>;

export interface NalUnit {
  /** `nal_unit_type`, the low 5 bits of the byte immediately after the start code. */
  type: number;
  /** Start code + header + payload, exactly as it appeared in the stream (Annex-B needs this intact). */
  raw: Bytes;
}

/**
 * Splits a raw Annex-B byte stream into NAL units. Since NAL boundaries rarely line up with
 * stdout chunk boundaries, any bytes from (and including) the last start code found are returned
 * as `remainder` instead of being parsed — the caller prepends `remainder` to the next chunk.
 */
export function splitNalUnits(buffer: Bytes): { units: NalUnit[]; remainder: Bytes } {
  const starts: number[] = [];
  for (let i = 0; i + 2 < buffer.length; i++) {
    if (buffer[i] === 0 && buffer[i + 1] === 0 && buffer[i + 2] === 1) {
      starts.push(i);
    }
  }

  if (starts.length < 2) {
    return { units: [], remainder: buffer.subarray(starts[0] ?? 0) };
  }

  const units: NalUnit[] = [];
  for (let i = 0; i < starts.length - 1; i++) {
    const rawStart = starts[i];
    const headerStart = rawStart + 3;
    let rawEnd = starts[i + 1];
    // A valid NAL unit's last byte is never 0x00 — rbsp_trailing_bits() always ends the payload
    // with a set "stop" bit — so a trailing zero here belongs to the *next* NAL's 4-byte start
    // code, not this unit's payload.
    if (buffer[rawEnd - 1] === 0) rawEnd -= 1;
    if (rawEnd <= headerStart) continue;
    units.push({ type: buffer[headerStart] & 0x1f, raw: buffer.subarray(rawStart, rawEnd) });
  }

  return { units, remainder: buffer.subarray(starts[starts.length - 1]) };
}

/**
 * Scans an access unit's concatenated Annex-B bytes for an SPS NAL (type 7) and returns the
 * three bytes WebCodecs' `avc1.PPCCLL` codec string encodes (profile_idc, constraint flags,
 * level_idc) — no exp-golomb parsing needed, since these are always the fixed first three bytes
 * of the SPS payload, right after the one-byte NAL header. Actual encoder output varies by
 * device/Android version (Baseline vs Main vs High profile, different levels), so a codec string
 * that doesn't match what's actually in the bitstream can make `VideoDecoder.configure()` reject
 * it outright on some devices even though the format ("annexb") is otherwise correct.
 */
export function findSpsProfileLevel(
  data: Bytes,
): { profileIdc: number; constraintFlags: number; levelIdc: number } | null {
  const { units } = splitNalUnits(data);
  for (const unit of units) {
    // raw = 3-byte start code + 1-byte NAL header + payload, so payload starts at index 4.
    if (unit.type === 7 && unit.raw.length >= 7) {
      return { profileIdc: unit.raw[4], constraintFlags: unit.raw[5], levelIdc: unit.raw[6] };
    }
  }
  return null;
}

export interface AccessUnit {
  /** Concatenated raw NAL units (start codes intact) for one frame — feed directly to WebCodecs. */
  data: Bytes;
  isKeyframe: boolean;
}

const NAL_TYPE_NON_IDR_SLICE = 1;
const NAL_TYPE_IDR_SLICE = 5;
const VCL_TYPES = new Set([NAL_TYPE_NON_IDR_SLICE, NAL_TYPE_IDR_SLICE]);

function concatBytes(a: Bytes, b: Bytes): Bytes {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Groups a stream of NAL units into access units (one per video frame). A new slice NAL
 * (type 1 or 5) while one is already pending means the previous frame is complete — any
 * leading SPS/PPS/SEI NALs ride along with the slice that follows them.
 */
export class AccessUnitReader {
  private leftover: Bytes = new Uint8Array(0);
  private pending: NalUnit[] = [];

  push(chunk: Bytes): AccessUnit[] {
    const { units, remainder } = splitNalUnits(concatBytes(this.leftover, chunk));
    this.leftover = remainder;

    const completed: AccessUnit[] = [];
    for (const unit of units) {
      if (VCL_TYPES.has(unit.type) && this.pending.some((u) => VCL_TYPES.has(u.type))) {
        completed.push(this.flush());
      }
      this.pending.push(unit);
    }
    return completed;
  }

  /** Call once the stream has ended to emit whatever frame was still being assembled. */
  flushRemaining(): AccessUnit | null {
    // The very last NAL of the stream is never bounded by a *following* start code — that's
    // exactly why `splitNalUnits` always defers it to `remainder` rather than emitting it — so
    // without this, it silently vanishes instead of joining `pending`. End-of-stream is itself a
    // valid boundary here, so recover it explicitly.
    if (this.leftover.length > 3) {
      for (let i = 0; i + 2 < this.leftover.length; i++) {
        if (this.leftover[i] === 0 && this.leftover[i + 1] === 0 && this.leftover[i + 2] === 1) {
          const headerStart = i + 3;
          if (headerStart < this.leftover.length) {
            this.pending.push({
              type: this.leftover[headerStart] & 0x1f,
              raw: this.leftover.subarray(i),
            });
          }
          break;
        }
      }
      this.leftover = new Uint8Array(0);
    }
    return this.pending.length > 0 ? this.flush() : null;
  }

  private flush(): AccessUnit {
    const isKeyframe = this.pending.some((u) => u.type === NAL_TYPE_IDR_SLICE);
    const totalLength = this.pending.reduce((sum, u) => sum + u.raw.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const unit of this.pending) {
      data.set(unit.raw, offset);
      offset += unit.raw.length;
    }
    this.pending = [];
    return { data, isKeyframe };
  }
}
