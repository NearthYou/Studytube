import assert from "node:assert/strict";
import test from "node:test";
import type { Course } from "../src/types.ts";

function course(
  id: number,
  title: string,
  updatedAt: string,
  videoTitles: string[],
): Course {
  return {
    id,
    title,
    description: `${title} 설명`,
    visibility: "private",
    status: "published",
    version: 1,
    createdAt: updatedAt,
    updatedAt,
    publishedAt: updatedAt,
    steps: videoTitles.map((videoTitle, index) => ({
      id: `${id}-${index}`,
      position: index + 1,
      snapshot: {
        title: videoTitle,
        videoUrl: `https://www.youtube.com/watch?v=video${id}${index}`,
        thumbnailUrl: `https://img.example/${id}-${index}.jpg`,
        channelName: "학습 채널",
      },
    })),
    feedback: [],
  };
}

async function loadFilter() {
  try {
    return await import("../src/features/course/courseLibrary.ts");
  } catch {
    assert.fail("저장 코스 검색과 필터를 담당하는 모듈이 없습니다.");
  }
}

const courses = [
  course(1, "중국어 회화", "2026-08-20T00:00:00.000Z", ["인사", "식당 주문"]),
  course(2, "개발 기초", "2026-08-27T00:00:00.000Z", [
    "C++ 입문",
    "포인터",
    "클래스",
    "템플릿",
  ]),
  course(3, "영어 듣기", "2026-08-25T00:00:00.000Z", ["뉴스", "인터뷰", "강연"]),
];

test("saved Course search includes video titles and sorts by recent update", async () => {
  const { filterAndSortCourses } = await loadFilter();

  assert.deepEqual(
    filterAndSortCourses(courses, {
      query: "c++",
      length: "all",
      sort: "recent",
    }).map((item) => item.id),
    [2],
  );
  assert.deepEqual(
    filterAndSortCourses(courses, {
      query: "",
      length: "all",
      sort: "recent",
    }).map((item) => item.id),
    [2, 3, 1],
  );
});

test("saved Course length filter separates compact and long Courses", async () => {
  const { filterAndSortCourses } = await loadFilter();

  assert.deepEqual(
    filterAndSortCourses(courses, {
      query: "",
      length: "short",
      sort: "name",
    }).map((item) => item.id),
    [3, 1],
  );
  assert.deepEqual(
    filterAndSortCourses(courses, {
      query: "",
      length: "long",
      sort: "name",
    }).map((item) => item.id),
    [2],
  );
});

test("removes only the archived Course from the saved Course collection", async () => {
  const library = await loadFilter();

  assert.equal(
    typeof library.removeCourseFromLibrary,
    "function",
    "저장 코스에서 삭제한 항목을 제거하는 동작이 없습니다.",
  );

  assert.deepEqual(
    library.removeCourseFromLibrary(courses, 2).map((item) => item.id),
    [1, 3],
  );
  assert.deepEqual(courses.map((item) => item.id), [1, 2, 3]);
});
