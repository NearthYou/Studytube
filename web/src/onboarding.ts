const LEARNING_HOME = "/";
const INTERNAL_ORIGIN = "https://studytube.local";

export function tutorialNextDestination(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /\p{Cc}/u.test(value)
  ) {
    return LEARNING_HOME;
  }
  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (
      parsed.origin !== INTERNAL_ORIGIN ||
      parsed.pathname === "/login" ||
      parsed.pathname === "/auth" ||
      parsed.pathname.startsWith("/auth/")
    ) {
      return LEARNING_HOME;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return LEARNING_HOME;
  }
}
