type VerificationLocation = Pick<Location, "hash" | "pathname" | "search">;
type VerificationHistory = Pick<History, "replaceState" | "state">;

const VERIFICATION_TOKEN_PATTERN =
  /^v1\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/u;

export async function consumeVerificationFragment(
  location: VerificationLocation,
  history: VerificationHistory,
  consume: (verificationToken: string) => Promise<void>,
): Promise<"consumed"> {
  const fragment = new URLSearchParams(location.hash.replace(/^#/u, ""));
  const tokens = fragment.getAll("verification");

  // Remove the secret from browser history before starting any network work.
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}`,
  );

  if (
    fragment.size !== 1 ||
    tokens.length !== 1 ||
    !VERIFICATION_TOKEN_PATTERN.test(tokens[0])
  ) {
    throw new Error("Verification link is invalid or missing");
  }

  await consume(tokens[0]);
  return "consumed";
}
