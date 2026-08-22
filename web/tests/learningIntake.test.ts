import assert from "node:assert/strict";
import test from "node:test";
import { startLearningIntake } from "../src/learningIntake.ts";
import { fetchLearningCaptions } from "../src/api.ts";

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

test("polls only the stored owner caption snapshot endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  globalThis.fetch = async (input) => {
    capturedUrl = String(input);
    return new Response(
      JSON.stringify({
        contextId: "13",
        generation: 0,
        phase: "source_pending",
        sourceLanguage: "",
        sourceSegments: [],
        koreanSegments: [],
        stale: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    await fetchLearningCaptions("13");
    assert.match(capturedUrl, /\/learning\/contexts\/13\/captions$/);
    assert.doesNotMatch(capturedUrl, /\/ai\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
