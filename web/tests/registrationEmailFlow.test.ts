import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptedRegistrationEmail,
  registrationEmailRequest,
} from "../src/registrationEmailFlow.ts";

test("switches an accepted signup to resend with the exact submitted email", () => {
  const sent = acceptedRegistrationEmail("  Ada@Example.com  ");

  assert.deepEqual(sent, { kind: "sent", email: "Ada@Example.com" });
  assert.deepEqual(registrationEmailRequest(sent, "changed@example.com"), {
    action: "resend",
    email: "Ada@Example.com",
  });
});

test("uses resend directly after an expired verification route", () => {
  assert.deepEqual(
    registrationEmailRequest({ kind: "initial" }, "  ada@example.com ", true),
    { action: "resend", email: "ada@example.com" },
  );
});

test("uses signup only for the initial signup submission", () => {
  assert.deepEqual(
    registrationEmailRequest({ kind: "initial" }, "ada@example.com"),
    { action: "signup", email: "ada@example.com" },
  );
});
