/** Passes chunks through unchanged, reporting a running byte total as they flow — used to get
 * upload progress out of `sync.write()`, which has no progress callback of its own. */
export function withProgress(
  stream: ReadableStream<Uint8Array>,
  onProgress: (bytesSent: number) => void,
): ReadableStream<Uint8Array> {
  let total = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        onProgress(total);
        controller.enqueue(chunk);
      },
    }),
  );
}
