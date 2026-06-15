import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync("web/src/App.tsx", "utf8");
const boardPageSource = appSource.slice(
  appSource.indexOf("function BoardPage"),
  appSource.indexOf("function CoursePage"),
);
const draftSource = readFileSync("web/src/playlistDrafts.ts", "utf8");

const text = {
  boardHeading: "\uC601\uC0C1 \uB4F1\uB85D",
  savedVideosFirst:
    "\uC800\uC7A5\uD55C \uC601\uC0C1\uC744 \uBA3C\uC800 \uD655\uC778",
  watchPlaylist:
    "\uD559\uC2B5 \uD654\uBA74\uC758 \uBCF4\uC720\uD55C \uD50C\uB808\uC774\uB9AC\uC2A4\uD2B8",
  continueInWatch:
    "\uD559\uC2B5\uC5D0\uC11C \uBC14\uB85C \uC774\uC5B4\uBCFC \uC218 \uC788\uC2B5\uB2C8\uB2E4",
  singleLearningPlaylist:
    "\uD604\uC7AC \uD559\uC2B5\uD560 \uD50C\uB808\uC774\uB9AC\uC2A4\uD2B8 \uD558\uB098\uB9CC \uD3B8\uC9D1\uD569\uB2C8\uB2E4",
  privatePlaylists:
    "\uBE44\uACF5\uAC1C \uB0B4 \uD50C\uB808\uC774\uB9AC\uC2A4\uD2B8",
  newPlaylist:
    "\uC0C8 \uD50C\uB808\uC774\uB9AC\uC2A4\uD2B8 \uB9CC\uB4E4\uAE30",
  boardPostWriting:
    "\uAC8C\uC2DC\uAE00 \uC791\uC131",
  publishAsPost:
    "\uAC8C\uC2DC\uAE00\uB85C \uACF5\uAC1C\uD558\uAE30",
  oldPlaylistHeading:
    "\uBA3C\uC800 \uB0B4 \uD50C\uB808\uC774\uB9AC\uC2A4\uD2B8\uC5D0 \uB2F4\uAE30",
  newLearningPlaylist:
    "\uC0C8 \uD559\uC2B5 \uD50C\uB808\uC774\uB9AC\uC2A4\uD2B8",
  editingNumber: "\uC791\uC131 \uC911 \\{index \\+ 1\\}",
  draftTitle:
    "\uB098\uB9CC\uC758 \uD559\uC2B5 \uD50C\uB808\uC774\uB9AC\uC2A4\uD2B8",
  courseDraft:
    "\uB098\uB9CC\uC758 \uD559\uC2B5 \uCF54\uC2A4",
  initialDraft: "\uCD08\uC548",
  publicPlaylist: "\uACF5\uAC1C \uD50C\uB808\uC774\uB9AC\uC2A4\uD2B8",
  course: "\uCF54\uC2A4",
} as const;

test("registration screen checks saved videos before playlist building", () => {
  assert.match(boardPageSource, new RegExp(`<h1>${text.boardHeading}</h1>`));
  assert.match(boardPageSource, new RegExp(text.savedVideosFirst));
  assert.match(boardPageSource, new RegExp(text.watchPlaylist));
  assert.match(boardPageSource, new RegExp(text.continueInWatch));
  assert.match(boardPageSource, new RegExp(text.privatePlaylists));
  assert.doesNotMatch(boardPageSource, new RegExp(text.singleLearningPlaylist));
  assert.doesNotMatch(boardPageSource, new RegExp(text.oldPlaylistHeading));
});

test("registration screen supports multiple private playlists before publishing", () => {
  assert.match(boardPageSource, new RegExp(text.newPlaylist));
  assert.match(boardPageSource, /className="draft-tabs"/);
  assert.match(boardPageSource, /className="draft-actions"/);
  assert.match(boardPageSource, /switchPlaylistDraft/);
  assert.match(boardPageSource, /createNewPlaylistDraft/);
  assert.match(boardPageSource, /deleteActivePlaylistDraft/);
  assert.match(boardPageSource, new RegExp(text.boardPostWriting));
  assert.match(boardPageSource, new RegExp(text.publishAsPost));
  assert.doesNotMatch(boardPageSource, /원할 때 보드에 업로드/);
  assert.doesNotMatch(boardPageSource, /보드 표시 정보/);
});

test("board layout puts saved videos second and playlist building third", () => {
  const cssSource = readFileSync("web/src/App.css", "utf8");

  assert.match(
    cssSource,
    /\.board-grid > \.post-browser\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2;/,
  );
  assert.match(
    cssSource,
    /\.board-grid > \.post-detail\s*\{[\s\S]*?grid-column:\s*2[\s\S]*?;[\s\S]*?grid-row:\s*2;/,
  );
  assert.match(
    cssSource,
    /\.board-grid > \.playlist-builder-panel\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?grid-row:\s*3;/,
  );
  assert.match(
    cssSource,
    /\.playlist-builder-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(360px,\s*0\.75fr\);/,
  );
  assert.match(
    cssSource,
    /\.board-grid\s*\{[\s\S]*?align-items:\s*stretch;/,
  );
});

test("saved video shelf stays compact in the desktop board layout", () => {
  const cssSource = readFileSync("web/src/App.css", "utf8");

  assert.match(
    cssSource,
    /\.board-post-list\s*\{[\s\S]*?max-height:\s*clamp\(500px,\s*52vh,\s*620px\);[\s\S]*?overflow-y:\s*auto;/,
  );
});

test("default registration draft title is a playlist title", () => {
  assert.match(draftSource, new RegExp(text.draftTitle));
  assert.doesNotMatch(draftSource, new RegExp(text.courseDraft));
  assert.doesNotMatch(draftSource, new RegExp(text.initialDraft));
});

test("visible app copy avoids draft terminology", () => {
  assert.doesNotMatch(appSource, new RegExp(text.initialDraft));
});

test("public playlist copy does not fall back to course wording", () => {
  assert.doesNotMatch(
    appSource,
    new RegExp(`${text.publicPlaylist}[^\\n"]*${text.course}`),
  );
});
