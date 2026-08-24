import assert from "node:assert/strict";
import test from "node:test";
import { runLearningOverviewPolling } from "../src/features/learning/overviewPolling.ts";
import type { LearningOverviewResponse } from "../src/types.ts";

const pending: LearningOverviewResponse = {
  contextId: "11",
  status: "pending",
  coverage: { scope: "study_range", startSeconds: 0, endSeconds: 30 },
};
const ready: LearningOverviewResponse = {
  ...pending,
  status: "ready",
  summary: { overview: "준비된 내용", chapters: [], takeaways: [] },
};

test("pending overview polls until the ready response", async () => {
  const responses = [pending, ready];
  const updates: LearningOverviewResponse[] = [];
  let waits = 0;

  await runLearningOverviewPolling({
    contextId: "11",
    signal: new AbortController().signal,
    fetchOverview: async () => responses.shift()!,
    wait: async () => {
      waits += 1;
    },
    onUpdate: (overview) => updates.push(overview),
  });

  assert.deepEqual(updates, [pending, ready]);
  assert.equal(waits, 1);
});

test("an aborted context ignores its late response", async () => {
  const controller = new AbortController();
  const updates: LearningOverviewResponse[] = [];
  let resolveFetch!: (value: LearningOverviewResponse) => void;
  const active = runLearningOverviewPolling({
    contextId: "old-context",
    signal: controller.signal,
    fetchOverview: () =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    wait: async () => undefined,
    onUpdate: (overview) => updates.push(overview),
  });

  controller.abort();
  resolveFetch(ready);
  await active;

  assert.deepEqual(updates, []);
});

test("unmount abort stops pending polling before another fetch", async () => {
  const controller = new AbortController();
  let fetches = 0;
  let releaseWait!: () => void;
  const active = runLearningOverviewPolling({
    contextId: "11",
    signal: controller.signal,
    fetchOverview: async () => {
      fetches += 1;
      return pending;
    },
    wait: (signal) =>
      new Promise((resolve) => {
        releaseWait = resolve;
        signal.addEventListener("abort", resolve, { once: true });
      }),
    onUpdate: () => undefined,
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  releaseWait();
  await active;

  assert.equal(fetches, 1);
});
