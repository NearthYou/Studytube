import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  canApproveNextProposal,
  initialNextProposalSelection,
  proposalFailurePhase,
} from "../src/features/learning/nextLearningProposalState.ts";

test("an empty Course list defaults to a validatable private Course choice", () => {
  const empty = initialNextProposalSelection([]);
  assert.deepEqual(empty, { kind: "new_private_course", title: "" });
  assert.equal(canApproveNextProposal("pending", empty), false);
  assert.equal(
    canApproveNextProposal("pending", {
      kind: "new_private_course",
      title: "나의 중국어 학습",
    }),
    true,
  );
});

test("an existing Course keeps the version shown when the learner selects it", () => {
  const selected = initialNextProposalSelection([{ id: 7, version: 3 }]);
  assert.deepEqual(selected, {
    kind: "existing_course",
    courseId: 7,
    expectedCourseVersion: 3,
  });
  assert.equal(canApproveNextProposal("processing", selected), false);
  assert.equal(canApproveNextProposal("success", selected), false);
});

test("expired, rejected and version conflict responses have separate recovery states", () => {
  assert.equal(proposalFailurePhase("LEARNING_PROPOSAL_EXPIRED"), "expired");
  assert.equal(proposalFailurePhase("LEARNING_PROPOSAL_REJECTED"), "rejected");
  assert.equal(
    proposalFailurePhase("LEARNING_VERSION_CONFLICT"),
    "version_conflict",
  );
});

test("approval UI submits only proposal identity and target selection", () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    resolve(directory, "../src/features/learning/NextLearningProposal.tsx"),
    "utf8",
  );
  assert.match(source, /proposalId: proposal\.id/);
  assert.match(source, /targetKind: selection\.kind/);
  assert.doesNotMatch(source, /videoUrl:/);
  assert.match(source, /새 비공개 Course/);
  assert.match(source, /반영 중/);
  assert.match(source, /제안 시간이 지나/);
  assert.match(source, /Course가 변경되었습니다/);
  assert.doesNotMatch(source, /Agent|MCP|RAG|AI/);
});

test("proposal actions reuse the shared authenticated API boundary", () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    resolve(directory, "../src/features/learning/NextLearningProposal.tsx"),
    "utf8",
  );

  assert.match(source, /approveLearningProposal/);
  assert.match(source, /dismissLearningProposal/);
  assert.match(source, /type LearningProposal/);
  assert.doesNotMatch(source, /apiBaseUrl|\bfetch\s*\(/);
  assert.doesNotMatch(source, /export type NextProposal/);
});
