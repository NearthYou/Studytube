import assert from "node:assert/strict";
import test from "node:test";

test("saved notes open in view mode and cancel discards an edit", async () => {
  const flow = await import(
    "../src/features/learning/savedNoteFlow.ts"
  ).catch(() => null);
  assert.ok(flow, "saved note flow should exist");

  let state = flow.createSavedNoteState("원래 메모");
  assert.deepEqual(state, {
    mode: "view",
    originalBody: "원래 메모",
    draftBody: "원래 메모",
  });

  state = flow.transitionSavedNote(state, { type: "edit" });
  state = flow.transitionSavedNote(state, {
    type: "change",
    body: "수정 중인 메모",
  });
  assert.equal(flow.canSaveSavedNote(state), true);

  state = flow.transitionSavedNote(state, { type: "cancel" });
  assert.equal(state.mode, "view");
  assert.equal(state.draftBody, "원래 메모");
  assert.equal(flow.canSaveSavedNote(state), false);
});

test("saved note returns to compact view after the updated body arrives", async () => {
  const flow = await import(
    "../src/features/learning/savedNoteFlow.ts"
  ).catch(() => null);
  assert.ok(flow, "saved note flow should exist");

  let state = flow.createSavedNoteState("원래 메모");
  state = flow.transitionSavedNote(state, { type: "edit" });
  state = flow.transitionSavedNote(state, {
    type: "change",
    body: "저장된 메모",
  });
  state = flow.transitionSavedNote(state, {
    type: "sync",
    body: "저장된 메모",
  });

  assert.deepEqual(state, {
    mode: "view",
    originalBody: "저장된 메모",
    draftBody: "저장된 메모",
  });
});
