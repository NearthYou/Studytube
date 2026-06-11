export type CourseAnalysisSource = {
  summary?: string;
  translatedNotes?: string;
};

export type CourseAnalysisSection = {
  heading: string;
  body: string;
};

const FALLBACK_KOREAN_ANALYSIS =
  'AI 분석 요약이 아직 부족합니다. 영상 분석하기를 다시 실행해 요약을 채워주세요.';

export function courseAnalysisSectionsFromPosts(
  posts: CourseAnalysisSource[],
): CourseAnalysisSection[] {
  return posts.map((post, index) => ({
    heading: `영상 ${index + 1}`,
    body: koreanAnalysisBody(post),
  }));
}

function koreanAnalysisBody(post: CourseAnalysisSource) {
  const candidate = [post.translatedNotes, post.summary]
    .map((value) => normalizeAnalysisText(value ?? ''))
    .find((value) => hasHangul(value));

  return candidate ? clipAnalysisText(candidate, 180) : FALLBACK_KOREAN_ANALYSIS;
}

function normalizeAnalysisText(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('AI 분석 요약:'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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
