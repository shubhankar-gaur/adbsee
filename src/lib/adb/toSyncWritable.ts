import type { MaybeConsumable, ReadableStream } from "@yume-chan/stream-extra";

// The DOM's native ReadableStream (from File.stream()) is functionally identical to
// stream-extra's at runtime; only a `closed` promise return-type quirk trips up structural typing.
export function toSyncWritable(
  stream: globalThis.ReadableStream<Uint8Array>,
): ReadableStream<MaybeConsumable<Uint8Array>> {
  return stream as unknown as ReadableStream<MaybeConsumable<Uint8Array>>;
}
