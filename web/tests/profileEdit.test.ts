import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "../src/types.ts";
import { profileEditDraftFromUser } from "../src/profileEdit.ts";

const user: User = {
  id: 1,
  name: "Ada",
  email: "ada@example.com",
  preferences: {
    interests: ["react", "english"],
    pace: "20 minutes a day",
    goal: "Review commute lessons",
  },
  createdAt: "2026-06-14T00:00:00.000Z",
};

test("builds a profile edit draft from the current user", () => {
  assert.deepEqual(profileEditDraftFromUser(user), {
    name: "Ada",
    email: "ada@example.com",
  });
});
