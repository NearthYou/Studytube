import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { fetchOwnerCourses } from "../../courseApi.ts";
import type { Course, Session } from "../../types.ts";
import {
  attachCourseSequence,
  queueVideoFromCourseStep,
} from "../../watchQueue.ts";
import { addVideosToQueue } from "../../watchQueueStorage.ts";
import {
  filterAndSortCourses,
  type CourseLengthFilter,
  type CourseSort,
} from "./courseLibrary.ts";
import "./CoursePage.css";

export function CourseLibraryPage({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [query, setQuery] = useState("");
  const [length, setLength] = useState<CourseLengthFilter>("all");
  const [sort, setSort] = useState<CourseSort>("recent");
  const [status, setStatus] = useState("저장한 코스를 불러오고 있어요.");

  useEffect(() => {
    let cancelled = false;
    void fetchOwnerCourses()
      .then((items) => {
        if (cancelled) return;
        setCourses(items);
        setStatus("");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("저장한 코스를 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.user.id]);

  const visibleCourses = useMemo(
    () => filterAndSortCourses(courses, { query, length, sort }),
    [courses, length, query, sort],
  );

  function playCourse(course: Course) {
    const videos = course.steps.map(queueVideoFromCourseStep);
    if (videos.length === 0) {
      setStatus("이 코스에는 재생할 수 있는 영상이 없어요.");
      return;
    }
    const courseVideos = attachCourseSequence(videos, {
      id: `saved-course-${course.id}`,
      title: course.title,
    });
    addVideosToQueue(courseVideos, courseVideos[0]);
    navigate(`/watch?videoId=${courseVideos[0].videoId}`);
  }

  return (
    <main className="page-shell course-page course-library-page">
      <header className="course-library-heading">
        <div>
          <h1>저장한 코스</h1>
          <p>코스와 포함된 영상을 검색하고 바로 이어서 학습하세요.</p>
        </div>
        <Link className="primary-link" to="/courses/new">
          새 코스 만들기
        </Link>
      </header>

      <section className="course-library" aria-labelledby="my-course-title">
        <div className="course-library-toolbar">
          <label>
            <span className="sr-only">저장한 코스 검색</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="코스나 영상 검색"
              type="search"
              value={query}
            />
          </label>
          <div className="course-length-filters" aria-label="영상 개수 필터">
            {([
              ["all", "전체"],
              ["short", "2~3개"],
              ["long", "4개 이상"],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={length === value}
                key={value}
                onClick={() => setLength(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <label className="course-sort-control">
            <span className="sr-only">정렬</span>
            <select
              onChange={(event) => setSort(event.target.value as CourseSort)}
              value={sort}
            >
              <option value="recent">최근 저장순</option>
              <option value="name">이름순</option>
            </select>
          </label>
        </div>

        <div className="section-title">
          <h2 id="my-course-title">내 코스</h2>
          <span>{visibleCourses.length}개</span>
        </div>

        {courses.length === 0 && !status ? (
          <div className="empty-product">
            <strong>저장한 코스가 없습니다</strong>
            <p>새 코스를 만들면 이곳에서 찾아볼 수 있어요.</p>
          </div>
        ) : visibleCourses.length === 0 && courses.length > 0 ? (
          <div className="empty-product">
            <strong>조건에 맞는 코스가 없습니다</strong>
            <p>검색어나 영상 개수 필터를 바꿔보세요.</p>
          </div>
        ) : (
          <div className="course-library-grid">
            {visibleCourses.map((course) => (
              <button
                className="course-library-card"
                key={course.id}
                onClick={() => playCourse(course)}
                type="button"
              >
                <span className="course-card-heading">
                  <span>
                    <strong>{course.title}</strong>
                    <small>{course.steps.length}개 영상</small>
                  </span>
                  <span className="course-open-label">코스 열기</span>
                </span>
                <span className="course-video-preview-list">
                  {course.steps.slice(0, 3).map((step, index) => (
                    <span className="course-video-preview" key={step.id}>
                      <img alt="" loading="lazy" src={step.snapshot.thumbnailUrl} />
                      <span>
                        <small>{index + 1}번째 영상</small>
                        <b>{step.snapshot.title}</b>
                      </span>
                    </span>
                  ))}
                  {course.steps.length > 3 && (
                    <span className="course-preview-more">
                      영상 {course.steps.length - 3}개 더 보기
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        {status && <p className="course-library-status">{status}</p>}
      </section>
    </main>
  );
}
