import type { Course } from "../../types.ts";

export type CourseLengthFilter = "all" | "short" | "long";
export type CourseSort = "recent" | "name";

export function filterAndSortCourses(
  courses: Course[],
  options: {
    query: string;
    length: CourseLengthFilter;
    sort: CourseSort;
  },
) {
  const query = options.query.trim().toLocaleLowerCase();
  return courses
    .filter((course) => course.status !== "archived")
    .filter((course) => {
      if (options.length === "short") {
        return course.steps.length >= 2 && course.steps.length <= 3;
      }
      if (options.length === "long") return course.steps.length >= 4;
      return true;
    })
    .filter((course) => {
      if (!query) return true;
      return [
        course.title,
        course.description,
        ...course.steps.flatMap((step) => [
          step.snapshot.title,
          step.snapshot.channelName,
        ]),
      ].some((value) => value.toLocaleLowerCase().includes(query));
    })
    .sort((left, right) => {
      if (options.sort === "name") {
        return left.title.localeCompare(right.title, "ko");
      }
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
}

export function removeCourseFromLibrary(courses: Course[], courseId: number) {
  return courses.filter((course) => course.id !== courseId);
}
