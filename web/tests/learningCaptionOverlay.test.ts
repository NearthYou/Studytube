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
    /\.learning-player-caption\s+p\s*\{[^}]*font-size:\s*clamp\(14px,\s*1\.55vw,\s*19px\)/,
  );
  assert.match(css, /bottom:\s*clamp\(96px,\s*17%,\s*138px\)/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
});
