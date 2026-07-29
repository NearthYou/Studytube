import type {
  CourseAggregate,
  CourseCursor,
  CourseStepInput,
  CreateCourseInput,
  PublicCourseFeedbackProjection,
  PublicCourseProjection,
} from './course.types';

export const COURSE_REPOSITORY = Symbol('COURSE_REPOSITORY');

export type CoursePageSlice<T> = {
  items: T[];
  hasMore: boolean;
};

export type CreateCourseCommand = {
  ownerId: number;
  idempotencyKeyDigest: Buffer;
  payloadHash: Buffer;
  course: CreateCourseInput;
};

export type CourseMutationCommand = {
  ownerId: number;
  courseId: number;
  expectedVersion: number;
};

export interface CourseRepository {
  create(command: CreateCourseCommand): Promise<CourseAggregate>;
  listOwner(
    ownerId: number,
    cursor: CourseCursor | null,
    limit: number,
  ): Promise<CoursePageSlice<CourseAggregate>>;
  findOwner(ownerId: number, courseId: number): Promise<CourseAggregate | null>;
  listPublic(
    cursor: CourseCursor | null,
    limit: number,
  ): Promise<CoursePageSlice<PublicCourseProjection>>;
  findPublic(courseId: number): Promise<PublicCourseProjection | null>;
  updateMetadata(
    command: CourseMutationCommand & {
      title?: string;
      description?: string;
    },
  ): Promise<CourseAggregate>;
  replaceSteps(
    command: CourseMutationCommand & { steps: CourseStepInput[] },
  ): Promise<CourseAggregate>;
  publish(command: CourseMutationCommand): Promise<CourseAggregate>;
  archive(command: CourseMutationCommand): Promise<CourseAggregate>;
  addFeedback(command: {
    authorId: number;
    courseId: number;
    rating: number;
    body: string;
  }): Promise<PublicCourseFeedbackProjection>;
}
