import assert from "node:assert/strict";
import test from "node:test";
import { consumeVerificationFragment } from "../src/verificationFlow.ts";

const TOKEN =
  "v1.11111111-1111-4111-8111-111111111111.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

test("removes the fragment before sending the verification token", async () => {
  const events: string[] = [];
  const consumed: string[] = [];

  const outcome = await consumeVerificationFragment(
    {
      hash: `#verification=${TOKEN}`,
      pathname: "/signup/verify",
      search: "?campaign=launch",
    },
    {
      state: { preserved: true },
      replaceState(state, _title, url) {
        assert.deepEqual(state, { preserved: true });
        assert.equal(url, "/signup/verify?campaign=launch");
        events.push("fragment_removed");
      },
    },
    async (token) => {
      events.push("consume_started");
      consumed.push(token);
    },
  );

  assert.equal(outcome, "consumed");
  assert.deepEqual(consumed, [TOKEN]);
  assert.deepEqual(events, ["fragment_removed", "consume_started"]);
});

test("clears and rejects malformed or duplicated verification fragments", async () => {
  for (const hash of [
    "#verification=not-a-token",
    `#verification=${TOKEN}&verification=${TOKEN}`,
    `#verification=${TOKEN}&unexpected=value`,
  ]) {
    let replaced = false;
    let consumed = false;

    await assert.rejects(
      consumeVerificationFragment(
        { hash, pathname: "/signup/verify", search: "" },
        {
          state: null,
          replaceState() {
            replaced = true;
          },
        },
        async () => {
          consumed = true;
        },
      ),
      /invalid or missing/i,
    );
    assert.equal(replaced, true);
    assert.equal(consumed, false);
  }
});

test("does not call the API when the fragment is missing", async () => {
  let replaced = false;
  let consumed = false;

  await assert.rejects(
    consumeVerificationFragment(
      { hash: "", pathname: "/signup/verify", search: "" },
      {
        state: null,
        replaceState() {
          replaced = true;
        },
      },
      async () => {
        consumed = true;
      },
    ),
    /invalid or missing/i,
  );

  assert.equal(replaced, true);
  assert.equal(consumed, false);
});
