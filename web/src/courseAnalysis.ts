export type CourseAnalysisSource = {
  summary?: string;
  translatedNotes?: string;
};

export type CourseAnalysisSection = {
  heading: string;
  body: string;
};

type CourseAnalysisSummarySection = {
  label?: string;
  body?: string;
};

const DUPLICATE_SIMILARITY_THRESHOLD = 0.72;

export function courseAnalysisSectionsFromPosts(
  posts: CourseAnalysisSource[],
): Array<CourseAnalysisSection | null> {
  return posts.map((post, index) => courseAnalysisSectionFromPost(post, index));
}

export function courseAnalysisSectionFromPost(
  post: CourseAnalysisSource,
  index: number,
): CourseAnalysisSection | null {
  const body = koreanAnalysisBody(post);

  return body ? { heading: `영상 ${index + 1}`, body } : null;
}

export function courseAnalysisBodyFromSummarySections(
  sections: CourseAnalysisSummarySection[],
) {
  const body = sections
    .map((section) =>
      [section.label, section.body]
        .map((value) => value?.trim() ?? "")
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");

  return courseAnalysisBodyFromText(body);
}

export function isRedundantCourseAnalysis(
  description: string,
  analysis: string,
) {
  const normalizedDescription = normalizeComparableText(description);
  const normalizedAnalysis = normalizeComparableText(analysis);

  if (normalizedDescription.length < 24 || normalizedAnalysis.length < 24) {
    return false;
  }

  if (
    normalizedDescription.includes(normalizedAnalysis) ||
    normalizedAnalysis.includes(normalizedDescription)
  ) {
    return true;
  }

  const descriptionTokens = uniqueMeaningfulTokens(normalizedDescription);
  const analysisTokens = uniqueMeaningfulTokens(normalizedAnalysis);

  if (descriptionTokens.length < 4 || analysisTokens.length < 4) {
    return false;
  }

  const sharedTokens = descriptionTokens.filter((token) =>
    analysisTokens.includes(token),
  );
  const smallerTokenCount = Math.min(
    descriptionTokens.length,
    analysisTokens.length,
  );

  return sharedTokens.length / smallerTokenCount >= DUPLICATE_SIMILARITY_THRESHOLD;
}

function koreanAnalysisBody(post: CourseAnalysisSource) {
  return courseAnalysisBodyFromText(post.translatedNotes ?? "");
}

function courseAnalysisBodyFromText(value: string) {
  const candidate = normalizeAnalysisText(value);

  return candidate && hasHangul(candidate) && !isPlaceholderAnalysis(candidate)
    ? clipAnalysisText(candidate, 180)
    : null;
}

function normalizeAnalysisText(value: string) {
  if (isPlaceholderAnalysis(value)) {
    return "";
  }

  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("AI 분석 요약:"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderAnalysis(value: string) {
  return [
    /AI 분석 요약이 아직 충분하지 않습니다/,
    /분석을 완료하지 못했지만 영상은 먼저 저장했습니다/,
    /핵심 개념,\s*구간별 학습 포인트,\s*복습 질문을 정리하세요/,
    /AI 요약 서비스 응답을 받지 못했습니다/,
    /자막을 다시 불러온 뒤 시도해 주세요/,
  ].some((pattern) => pattern.test(value));
}

function normalizeComparableText(value: string) {
  return value
    .replace(/핵심\s*요약/g, "")
    .replace(/AI\s*영상\s*분석\s*요약/g, "")
    .replace(/설명/g, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function uniqueMeaningfulTokens(value: string) {
  return [...new Set(value.split(" ").filter((token) => token.length >= 2))];
}

function hasHangul(value: string) {
  return /[가-힣]/.test(value);
}

function clipAnalysisText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}...`;
}
