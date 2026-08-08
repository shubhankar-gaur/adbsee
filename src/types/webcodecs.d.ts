export {};

// TypeScript's bundled WebCodecs types haven't caught up with the spec's Annex-B decoder
// option yet, even though it's shipped in Chrome — augment rather than losing type safety
// on the rest of VideoDecoderConfig.
declare global {
  interface VideoDecoderConfig {
    avc?: { format?: "annexb" | "avc" };
  }
}
