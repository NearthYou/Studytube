import assert from "node:assert/strict";
import test from "node:test";
import {
  clearStudyTubeStorage,
  ensureStudyTubeStorageEpoch,
  STUDYTUBE_STORAGE_EPOCH,
} from "../src/studyStorageReset.ts";

test("a new storage epoch clears only previous StudyTube data once", () => {
  const local = storage({
    "studytube.session": '{"user":{"id":7}}',
    "studytube.watchQueue:user-7": '[{"id":"old"}]',
    "studytube:caption-preferences:v1": '{"visible":true}',
    "another-app.setting": "keep",
  });
  const session = storage({
    "studytube.learningSession:user-7:video": '{"notes":[]}',
    "another-app.session": "keep",
  });

  ensureStudyTubeStorageEpoch(local, session);

  assert.equal(local.getItem("studytube.session"), null);
  assert.equal(local.getItem("studytube.watchQueue:user-7"), null);
  assert.equal(local.getItem("studytube:caption-preferences:v1"), null);
  assert.equal(session.getItem("studytube.learningSession:user-7:video"), null);
  assert.equal(local.getItem("another-app.setting"), "keep");
  assert.equal(session.getItem("another-app.session"), "keep");
  assert.equal(
    local.getItem("studytube.storageEpoch"),
    STUDYTUBE_STORAGE_EPOCH,
  );

  local.setItem("studytube.watchQueue:user-8", '[{"id":"new"}]');
  ensureStudyTubeStorageEpoch(local, session);
  assert.equal(local.getItem("studytube.watchQueue:user-8"), '[{"id":"new"}]');
});

test("account deletion can clear every StudyTube key without touching other apps", () => {
  const target = storage({
    "studytube.session": "session",
    "studytube:caption-preferences:v1": "caption",
    "studytube.storageEpoch": STUDYTUBE_STORAGE_EPOCH,
    "another-app.setting": "keep",
  });

  clearStudyTubeStorage(target);

  assert.equal(target.getItem("studytube.session"), null);
  assert.equal(target.getItem("studytube:caption-preferences:v1"), null);
  assert.equal(target.getItem("studytube.storageEpoch"), null);
  assert.equal(target.getItem("another-app.setting"), "keep");
});

function storage(initial: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}
