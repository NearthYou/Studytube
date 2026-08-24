import type { LiveCaptionChunkResponse } from "../../api.ts";

export type LiveCaptionChunk = LiveCaptionChunkResponse;

export function mergeLiveCaptionChunk(
  chunks: readonly LiveCaptionChunk[],
  incoming: LiveCaptionChunk,
): LiveCaptionChunk[] {
  return [...chunks.filter((chunk) => chunk.ordinal !== incoming.ordinal), incoming]
    .sort((left, right) => left.ordinal - right.ordinal);
}

const RECORDING_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
] as const;

export function selectRecordingMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): string {
  return RECORDING_TYPES.find(isTypeSupported) ?? "";
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
