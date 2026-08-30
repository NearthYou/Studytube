import assert from "node:assert/strict";
import test from "node:test";

test("caption preferences persist visibility opacity and size", async () => {
  const preferences = await import(
    "../src/features/learning/captionPreferences.ts"
  ).catch(() => null);
  assert.ok(preferences, "caption preferences should exist");

  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
  const selected = {
    visible: false,
    backgroundOpacity: 0.55,
    size: "large" as const,
  };

  preferences.saveCaptionPreferences(selected, storage);

  assert.deepEqual(preferences.loadCaptionPreferences(storage), selected);
});

test("invalid caption preferences fall back to readable defaults", async () => {
  const preferences = await import(
    "../src/features/learning/captionPreferences.ts"
  ).catch(() => null);
  assert.ok(preferences, "caption preferences should exist");

  const storage = {
    getItem() {
      return JSON.stringify({
        visible: "yes",
        backgroundOpacity: 4,
        size: "huge",
      });
    },
    setItem() {},
  };

  assert.deepEqual(preferences.loadCaptionPreferences(storage), {
    visible: true,
    backgroundOpacity: 0.74,
    size: "medium",
  });
});

test("caption background opacity accepts the full zero to one range", async () => {
  const preferences = await import(
    "../src/features/learning/captionPreferences.ts"
  ).catch(() => null);
  assert.ok(preferences, "caption preferences should exist");

  for (const backgroundOpacity of [0, 1]) {
    const storage = {
      getItem() {
        return JSON.stringify({
          visible: true,
          backgroundOpacity,
          size: "medium",
        });
      },
      setItem() {},
    };

    assert.equal(
      preferences.loadCaptionPreferences(storage).backgroundOpacity,
      backgroundOpacity,
    );
  }
});
