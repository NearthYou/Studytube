export type AiSetRecord = {
  // FastAPI로 보낼 세트 하나의 타입이다.
  setNumber: number; // 몇 번째 세트인지 담는다.
  reps: number; // 해당 세트에서 몇 회 했는지 담는다.
  perceivedDifficulty?: number | null; // 힘들었던 정도는 없을 수도 있다.
};

export type AiExerciseRecord = {
  // FastAPI로 보낼 운동 하나의 타입이다.
  exerciseName: string; // 운동 이름을 담는다.
  weightKg: number; // 사용한 무게를 담는다.
  targetReps?: number | null; // 목표 반복 수는 없을 수도 있다.
  sets: AiSetRecord[]; // 이 운동에 포함된 세트 목록을 담는다.
};

export type AiPostRecord = {
  // FastAPI로 보낼 게시글 하나의 타입이다.
  id: number; // 게시글 id를 담는다.
  title: string; // 게시글 제목을 담는다.
  date: string; // 운동 날짜를 문자열로 담는다.
  bodyPart: string; // 운동 부위를 담는다.
  memo?: string | null; // 메모는 없을 수도 있다.
  exercises: AiExerciseRecord[]; // 게시글 안의 운동 목록을 담는다.
};

export type AnalyzePostRequest = {
  // NestJS가 FastAPI로 보낼 분석 요청 타입이다.
  currentPost: AiPostRecord; // 지금 분석할 현재 게시글이다.
  previousPosts: AiPostRecord[]; // 비교에 사용할 이전 게시글 목록이다.
  toolCalls?: AiToolCallRecord[]; // 분석 전에 호출한 tool 기록이다.
};

export type AiToolCallRecord = {
  toolName: string;
  input: string;
  output: string;
  status: string;
  source: string;
};

export type AiWorkflowStepRecord = {
  step: number;
  name: string;
  status: string;
  detail: string;
};

export type AnalyzePostResponse = {
  // FastAPI가 NestJS로 돌려줄 분석 결과 타입이다.
  summary: string; // 운동 기록 요약이다.
  recommendation: string; // 다음 운동 방향 추천이다.
  nextGoal: string; // 다음 운동 목표다.
  referencedPostCount: number; // 참고한 이전 기록 개수다.
  referencedPosts: {
    id: number;
    title: string;
    date: string;
    matchedExercises: string[];
  }[];
  basis: string[];
  analysisMode: string;
  toolCalls: AiToolCallRecord[];
  workflowSteps: AiWorkflowStepRecord[];
};

export type NormalizeExercisesResponse = {
  normalizedNames: string[];
  toolCalls: AiToolCallRecord[];
};

export type AiHealthResponse = {
  // FastAPI 내부 health check가 NestJS로 돌려주는 응답 타입이다.
  status: string; // AI 서버가 정상인지 표시한다.
  service: string; // 응답을 보낸 서버 이름이다.
  scope: string; // 공개 health인지 내부 health인지 구분한다.
};
