import assert from "node:assert/strict";
import test from "node:test";
import { tutorialNextDestination } from "../src/onboarding.ts";

test("keeps a useful protected return path after the tutorial", () => {
  assert.equal(tutorialNextDestination("/watch"), "/watch");
  assert.equal(tutorialNextDestination("/courses"), "/courses");
});

test("uses learning home for missing, auth, and external tutorial destinations", () => {
  assert.equal(tutorialNextDestination(undefined), "/");
  assert.equal(tutorialNextDestination("/login"), "/");
  assert.equal(tutorialNextDestination("/auth/google/complete"), "/");
  assert.equal(tutorialNextDestination("https://example.com"), "/");
  assert.equal(tutorialNextDestination("//example.com"), "/");
});
