const GOOGLE_AUTH_MESSAGES: Readonly<Record<string, string>> = {
  cancelled: "Google 로그인을 취소했어요.",
  expired: "로그인 시간이 지났어요. 다시 시작해 주세요.",
  unavailable: "지금은 로그인할 수 없어요. 잠시 후 다시 시도해 주세요.",
};

export function googleAuthErrorMessage(code: string | null | undefined) {
  return code ? (GOOGLE_AUTH_MESSAGES[code] ?? "") : "";
}

export function accountDeletedMessage(value: string | null | undefined) {
  return value === "1" ? "계정과 학습 기록을 삭제했어요." : "";
}

export function safeGoogleReturnPath(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /\p{Cc}/u.test(value)
  ) {
    return "/";
  }
  try {
    const parsed = new URL(value, "https://studytube.local");
    if (
      parsed.origin !== "https://studytube.local" ||
      parsed.pathname === "/auth" ||
      parsed.pathname.startsWith("/auth/")
    ) {
      return "/";
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}
