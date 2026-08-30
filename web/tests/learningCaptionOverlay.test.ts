import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));

test("learning captions show the source before Korean at the same size", () => {
  const player = readFileSync(
    resolve(testDirectory, "../src/features/learning/LearningVideoPlayer.tsx"),
    "utf8",
  );
  const css = readFileSync(resolve(testDirectory, "../src/App.css"), "utf8");
  const source = player.indexOf('className="learning-caption-source"');
  const korean = player.indexOf('className="learning-caption-korean"');

  assert.ok(source >= 0);
  assert.ok(korean > source);
  assert.match(
    css,
    /\.learning-player-caption\s+p\s*\{[^}]*font-size:\s*var\(--learning-caption-size\)/,
  );
  assert.match(css, /bottom:\s*clamp\(44px,\s*7%,\s*58px\)/);
  assert.match(css, /bottom:\s*clamp\(84px,\s*15%,\s*120px\)/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
});

test("caption controls stay compact and expose the full opacity range", () => {
  const player = readFileSync(
    resolve(testDirectory, "../src/features/learning/LearningVideoPlayer.tsx"),
    "utf8",
  );
  const css = readFileSync(resolve(testDirectory, "../src/App.css"), "utf8");

  assert.match(player, /자막 끄기/);
  assert.match(player, /자막 켜기/);
  assert.doesNotMatch(player, /aria-pressed=\{captionPreferences\.visible\}/);
  assert.match(player, /small: "자막 작게"/);
  assert.match(player, /medium: "자막 보통"/);
  assert.match(player, /large: "자막 크게"/);
  assert.doesNotMatch(player, />크기</);
  assert.doesNotMatch(player, />작게</);
  assert.doesNotMatch(player, />보통</);
  assert.doesNotMatch(player, />크게</);
  assert.match(player, /aria-label="자막 배경 진하기"/);
  assert.match(player, /min="0"/);
  assert.match(player, /max="100"/);
  assert.match(player, /type="range"/);
  assert.match(
    css,
    /background:\s*rgb\(0 0 0 \/ var\(--learning-caption-opacity, 0\.74\)\)/,
  );
  assert.match(css, /\.caption-opacity-control\s*\{/);
  assert.match(css, /\.caption-opacity-control input\s*\{[^}]*height:\s*44px/);
});
