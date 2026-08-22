import assert from "node:assert/strict";
import test from "node:test";
import { startLearningIntake } from "../src/learningIntake.ts";

test("submits only the URL and bounded requested audio duration", async () => {
  const originalFetch = globalThis.fetch;
  let captured: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    captured = { input: String(input), init };
    return new Response(
      JSON.stringify({
        admission: "created",
        workId: "8f8de73b-6f6a-42a4-a550-a515b4206cb1",
        reservedAudioSeconds: 600,
        context: { studyContext: { id: "13" } },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await startLearningIntake({
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      requestedAudioSeconds: 600,
    });
    assert.match(captured?.input ?? "", /\/learning\/items\/intake$/);
    assert.equal(captured?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(captured?.init?.body)), {
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      requestedAudioSeconds: 600,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
