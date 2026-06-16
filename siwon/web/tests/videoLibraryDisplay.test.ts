import assert from "node:assert/strict";
import test from "node:test";
import { videoLibraryAnalysisPreview } from "../src/videoLibraryDisplay.ts";

test("clips long transcript copy for video library analysis previews", () => {
  const transcript = Array.from(
    { length: 40 },
    (_, index) =>
      `자막 ${index + 1}: 리액트 상태 관리 흐름과 컴포넌트 렌더링 과정을 설명합니다.`,
  ).join("\n");

  const preview = videoLibraryAnalysisPreview(
    {
      channelName: "StudyTube",
      summary: transcript,
      title: "React State",
    },
    160,
  );

  assert.ok(preview.length <= 163);
  assert.match(preview, /\.\.\.$/);
  assert.doesNotMatch(preview, /\n/);
});

test("keeps short Korean analysis previews unchanged", () => {
  const preview = videoLibraryAnalysisPreview({
    channelName: "StudyTube",
    summary: "상태 변경과 렌더링 흐름을 예제로 정리한 영상입니다.",
    title: "React State",
  });

  assert.equal(preview, "상태 변경과 렌더링 흐름을 예제로 정리한 영상입니다.");
});
