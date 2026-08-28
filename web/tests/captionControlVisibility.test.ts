import assert from "node:assert/strict";
import test from "node:test";

async function loadPolicy() {
  try {
    return await import(
      "../src/features/learning/captionControlVisibility.ts"
    );
  } catch {
    assert.fail("자막 위치를 내릴 조건을 판단하는 모듈이 없습니다.");
  }
}

test("caption lowers only while playing after the pointer leaves the player", async () => {
  const { shouldScheduleCaptionLowering } = await loadPolicy();

  assert.equal(
    shouldScheduleCaptionLowering({ playing: true, pointerInside: false }),
    true,
  );
  assert.equal(
    shouldScheduleCaptionLowering({ playing: true, pointerInside: true }),
    false,
  );
  assert.equal(
    shouldScheduleCaptionLowering({ playing: false, pointerInside: false }),
    false,
  );
});
