import assert from "node:assert/strict";
import test from "node:test";
import {
  courseAnalysisBodyFromSummarySections,
  courseAnalysisSectionsFromPosts,
  isRedundantCourseAnalysis,
} from "../src/courseAnalysis.ts";

test("formats one Korean analysis section per video", () => {
  const sections = courseAnalysisSectionsFromPosts([
    {
      summary:
        "A practical React hooks lesson covering useState, useEffect, useMemo, and useCallback.",
      translatedNotes:
        "리액트 훅의 상태 관리, 효과 처리, 메모이제이션, 커스텀 훅을 실제 예제로 복습합니다.",
    },
    {
      summary:
        "Explains server state, caching, refetching, query keys, and mutation flows for React applications.",
      translatedNotes:
        "서버 상태 관리와 캐싱, 재요청, 쿼리 키, 변경 요청 흐름을 리액트 앱 기준으로 정리합니다.",
    },
  ]);

  assert.equal(sections.length, 2);
  assert.deepEqual(
    sections.map((section) => section.heading),
    ["영상 1", "영상 2"],
  );
  assert.match(sections[0].body, /리액트 훅/);
  assert.match(sections[1].body, /서버 상태 관리/);
  assert.doesNotMatch(
    sections.map((section) => section.body).join(" "),
    /A practical|Explains server state/,
  );
});

test("does not fabricate analysis when a video has no Korean analysis", () => {
  const sections = courseAnalysisSectionsFromPosts([
    {
      summary: "This lesson only has an English summary.",
      translatedNotes: "",
    },
  ]);

  assert.equal(sections[0], null);
});

test("ignores saved placeholder analysis notes", () => {
  const sections = courseAnalysisSectionsFromPosts([
    {
      summary:
        "Unity Korea 채널의 SOLID 디자인패턴 실전 영상입니다. 제목과 채널 정보를 바탕으로 학습할 핵심 내용을 한글로 정리한 설명입니다.",
      translatedNotes:
        "Unity Korea 채널의 SOLID 디자인패턴 실전 영상입니다.\n\nAI 분석 요약: 핵심 개념, 구간별 학습 포인트, 복습 질문을 정리하세요.",
    },
  ]);

  assert.equal(sections[0], null);
});

test("detects AI summaries that repeat the visible description", () => {
  const description =
    "이 영상은 제목, 채널, 저장된 설명을 기준으로 학습 맥락을 정리한 자료입니다. 외부 AI 요약을 사용할 수 없어도 영상의 핵심 주제와 복습 방향을 한국어로 확인할 수 있습니다.";
  const repeatedAnalysis =
    "핵심 요약 이 영상은 제목, 채널, 저장된 설명을 기준으로 학습 맥락을 정리한 자료입니다. 외부 AI 요약을 사용할 수 없어도 영상의 핵심 주제와 복습 방향을 한국어로 확인할 수 있습니다.";

  assert.equal(
    isRedundantCourseAnalysis(description, repeatedAnalysis),
    true,
  );
});

test("keeps AI summaries when they add distinct learning value", () => {
  const description =
    "Unity Korea 채널의 SOLID 디자인패턴 실전 영상입니다. 제목과 채널 정보를 바탕으로 학습할 핵심 내용을 한글로 정리한 설명입니다.";
  const analysis =
    "의존성 역전과 인터페이스 분리를 게임 오브젝트 설계에 적용하며, 유지보수 가능한 Unity 코드 구조를 복습합니다.";

  assert.equal(isRedundantCourseAnalysis(description, analysis), false);
});

test("formats generated Korean summary sections as course analysis", () => {
  const body = courseAnalysisBodyFromSummarySections([
    {
      label: "핵심 요약",
      body: "SOLID 원칙 중 의존성 역전과 인터페이스 분리를 Unity 코드 구조에 적용합니다.",
    },
    {
      label: "복습 포인트",
      body: "구현체가 아니라 추상화에 의존하도록 설계를 점검합니다.",
    },
  ]);

  assert.match(body ?? "", /SOLID 원칙/);
  assert.match(body ?? "", /복습 포인트/);
});

test("rejects generated summary service fallback sections", () => {
  const body = courseAnalysisBodyFromSummarySections([
    {
      label: "요약 생성 실패",
      body: "AI 요약 서비스 응답을 받지 못했습니다. 자막을 다시 불러온 뒤 시도해 주세요.",
    },
  ]);

  assert.equal(body, null);
});
