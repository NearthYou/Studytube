import { koreanVideoDescription } from "./postEditor.ts";
import { clipText } from "./videoSummaryDetails.ts";

export const VIDEO_LIBRARY_ANALYSIS_PREVIEW_LIMIT = 260;

export type VideoLibraryAnalysisPreviewInput = {
  channelName: string;
  summary?: string;
  title: string;
};

export function videoLibraryAnalysisPreview(
  input: VideoLibraryAnalysisPreviewInput,
  limit = VIDEO_LIBRARY_ANALYSIS_PREVIEW_LIMIT,
) {
  return clipText(
    koreanVideoDescription({
      ...input,
      summary: input.summary?.replace(/\s+/g, " ").trim(),
    }),
    limit,
  );
}
