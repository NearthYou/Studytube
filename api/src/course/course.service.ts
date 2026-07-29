import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CourseCutoverPolicy } from './course-cutover.policy';
import { CourseNotFoundError, CourseValidationError } from './course.errors';
import {
  COURSE_LIMITS,
  decodeCourseCursor,
  encodeCourseCursor,
  toOwnerCourseProjection,
  validateCourseStepInputs,
  validateCourseTitle,
} from './course.policy';
import type { CourseRepository } from './course.repository';
import type {
  CoursePage,
  CreateCourseFeedbackInput,
  CreateCourseInput,
  OwnerCourseProjection,
  PublicCourseFeedbackProjection,
  PublicCourseProjection,
  ReplaceCourseStepsInput,
  UpdateCourseMetadataInput,
} from './course.types';

const DEFAULT_LEARNING_STATE = Object.freeze({
  captionLanguage: 'ko' as const,
  captionsEnabled: true,
  playbackRate: 1 as const,
  loop: Object.freeze({ enabled: false, manual: false, start: 0, end: 15 }),
  marks: Object.freeze([]),
});

@Injectable()
export class CourseService {
  constructor(
    private readonly repository: CourseRepository,
    private readonly cutoverPolicy: CourseCutoverPolicy,
  ) {}

  async createCourse(
    ownerId: number,
    idempotencyKey: string | undefined,
    input: CreateCourseInput,
  ): Promise<OwnerCourseProjection> {
    this.cutoverPolicy.assertCourseMutationAllowed();
    const normalizedKey = validateIdempotencyKey(idempotencyKey);
    const course = normalizeCreateInput(input);
    const aggregate = await this.repository.create({
      ownerId: validatePositiveId(ownerId, 'ownerId'),
      idempotencyKeyDigest: sha256(normalizedKey),
      payloadHash: sha256(canonicalJson(course)),
      course,
    });
    return toOwnerCourseProjection(aggregate);
  }

  async listOwnerCourses(
    ownerId: number,
    encodedCursor?: string,
    limit = 20,
  ): Promise<CoursePage<OwnerCourseProjection>> {
    const cursor = encodedCursor
      ? decodeCourseCursor(encodedCursor, 'owner')
      : null;
    const slice = await this.repository.listOwner(
      validatePositiveId(ownerId, 'ownerId'),
      cursor,
      validatePageSize(limit),
    );
    const items = slice.items.map(toOwnerCourseProjection);
    return {
      items,
      nextCursor:
        slice.hasMore && slice.nextCursor
          ? encodeCourseCursor({
              kind: 'owner',
              ...slice.nextCursor,
            })
          : null,
    };
  }

  async getOwnerCourse(
    ownerId: number,
    courseId: number,
  ): Promise<OwnerCourseProjection> {
    const aggregate = await this.repository.findOwner(
      validatePositiveId(ownerId, 'ownerId'),
      validatePositiveId(courseId, 'courseId'),
    );
    if (!aggregate) {
      throw new CourseNotFoundError();
    }
    return toOwnerCourseProjection(aggregate);
  }

  async listPublicCourses(
    encodedCursor?: string,
    limit = 20,
  ): Promise<CoursePage<PublicCourseProjection>> {
    const cursor = encodedCursor
      ? decodeCourseCursor(encodedCursor, 'public')
      : null;
    const slice = await this.repository.listPublic(
      cursor,
      validatePageSize(limit),
    );
    return {
      items: slice.items,
      nextCursor:
        slice.hasMore && slice.nextCursor
          ? encodeCourseCursor({
              kind: 'public',
              ...slice.nextCursor,
            })
          : null,
    };
  }

  async getPublicCourse(courseId: number): Promise<PublicCourseProjection> {
    const course = await this.repository.findPublic(
      validatePositiveId(courseId, 'courseId'),
    );
    if (!course) {
      throw new CourseNotFoundError();
    }
    return course;
  }

  async updateMetadata(
    ownerId: number,
    courseId: number,
    input: UpdateCourseMetadataInput,
  ): Promise<OwnerCourseProjection> {
    this.cutoverPolicy.assertCourseMutationAllowed();
    const title =
      input.title === undefined ? undefined : validateCourseTitle(input.title);
    const description =
      input.description === undefined
        ? undefined
        : validateDescription(input.description);
    if (title === undefined && description === undefined) {
      throw new CourseValidationError(
        'body',
        'title or description must be provided',
      );
    }
    return toOwnerCourseProjection(
      await this.repository.updateMetadata({
        ownerId: validatePositiveId(ownerId, 'ownerId'),
        courseId: validatePositiveId(courseId, 'courseId'),
        expectedVersion: validateVersion(input.expectedVersion),
        title,
        description,
      }),
    );
  }

  async replaceSteps(
    ownerId: number,
    courseId: number,
    input: ReplaceCourseStepsInput,
  ): Promise<OwnerCourseProjection> {
    this.cutoverPolicy.assertCourseMutationAllowed();
    return toOwnerCourseProjection(
      await this.repository.replaceSteps({
        ownerId: validatePositiveId(ownerId, 'ownerId'),
        courseId: validatePositiveId(courseId, 'courseId'),
        expectedVersion: validateVersion(input.expectedVersion),
        steps: validateCourseStepInputs(input.steps, 'replace'),
      }),
    );
  }

  async publish(
    ownerId: number,
    courseId: number,
    expectedVersion: number,
  ): Promise<OwnerCourseProjection> {
    this.cutoverPolicy.assertCourseMutationAllowed();
    return toOwnerCourseProjection(
      await this.repository.publish(
        mutation(ownerId, courseId, expectedVersion),
      ),
    );
  }

  async archive(
    ownerId: number,
    courseId: number,
    expectedVersion: number,
  ): Promise<OwnerCourseProjection> {
    this.cutoverPolicy.assertCourseMutationAllowed();
    return toOwnerCourseProjection(
      await this.repository.archive(
        mutation(ownerId, courseId, expectedVersion),
      ),
    );
  }

  async addFeedback(
    authorId: number,
    courseId: number,
    input: CreateCourseFeedbackInput,
  ): Promise<PublicCourseFeedbackProjection> {
    this.cutoverPolicy.assertCourseMutationAllowed();
    if (
      !Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5
    ) {
      throw new CourseValidationError(
        'rating',
        'rating must be an integer from 1 to 5',
      );
    }
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!body || body.length > COURSE_LIMITS.feedbackBody) {
      throw new CourseValidationError(
        'body',
        `body must contain at most ${COURSE_LIMITS.feedbackBody} characters`,
      );
    }
    return this.repository.addFeedback({
      authorId: validatePositiveId(authorId, 'authorId'),
      courseId: validatePositiveId(courseId, 'courseId'),
      rating: input.rating,
      body,
    });
  }
}

function normalizeCreateInput(input: CreateCourseInput): CreateCourseInput {
  const steps = validateCourseStepInputs(input.steps, 'create').map((step) => {
    const ownerLearningState =
      'ownerLearningState' in step && step.ownerLearningState
        ? step.ownerLearningState
        : {
            ...DEFAULT_LEARNING_STATE,
            loop: { ...DEFAULT_LEARNING_STATE.loop },
            marks: [],
          };
    return 'sourcePostId' in step
      ? { sourcePostId: step.sourcePostId, ownerLearningState }
      : { snapshot: step.snapshot, ownerLearningState };
  }) as CreateCourseInput['steps'];
  return {
    title: validateCourseTitle(input.title),
    description: validateDescription(input.description),
    steps,
  };
}

function mutation(ownerId: number, courseId: number, expectedVersion: number) {
  return {
    ownerId: validatePositiveId(ownerId, 'ownerId'),
    courseId: validatePositiveId(courseId, 'courseId'),
    expectedVersion: validateVersion(expectedVersion),
  };
}

function validateDescription(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CourseValidationError(
      'description',
      'description must be a string',
    );
  }
  const normalized = value.trim();
  if (normalized.length > COURSE_LIMITS.description) {
    throw new CourseValidationError(
      'description',
      `description must be at most ${COURSE_LIMITS.description} characters`,
    );
  }
  return normalized;
}

function validateIdempotencyKey(value: string | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > COURSE_LIMITS.idempotencyKey) {
    throw new CourseValidationError(
      'Idempotency-Key',
      `Idempotency-Key is required and must be at most ${COURSE_LIMITS.idempotencyKey} characters`,
    );
  }
  return normalized;
}

function validatePositiveId(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CourseValidationError(
      field,
      `${field} must be a positive integer`,
    );
  }
  return value;
}

function validateVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CourseValidationError(
      'expectedVersion',
      'expectedVersion must be a positive integer',
    );
  }
  return value;
}

function validatePageSize(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > COURSE_LIMITS.pageSize
  ) {
    throw new CourseValidationError(
      'limit',
      `limit must be an integer from 1 to ${COURSE_LIMITS.pageSize}`,
    );
  }
  return value;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
