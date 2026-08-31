import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  LearningLifecycleError,
  LearningNotFoundError,
  LearningPersistenceUnavailableError,
  LearningProposalExpiredError,
  LearningProposalRejectedError,
  LearningValidationError,
  LearningVersionConflictError,
} from './learning.errors';
import type { LearningProposalRepository } from './learning-proposal.repository';
import type {
  LearningProposal,
  LearningProposalState,
  ProposalApprovalTarget,
  ProposedCourseStep,
} from './learning.types';
import {
  canonicalizeYoutubeUrl,
  InvalidYoutubeUrlError,
} from './youtube-url.policy';

type ProposalRow = {
  id: string;
  ownerId: number;
  agentRunId: string;
  videoSourceId: string;
  proposalVersion: number;
  state: LearningProposalState;
  payload: unknown;
  payloadDigest: Buffer;
  expiresAt: Date;
  approvedCourseId: number | null;
  approvedCourseVersion: number | null;
  approvalTargetDigest: Buffer | null;
};

type ProposalPayload = {
  schemaVersion: 1;
  candidate: ProposedCourseStep;
  reason: string;
  canonicalVideoId: string;
};

const DEFAULT_LEARNING_STATE = {
  captionLanguage: 'ko',
  captionsEnabled: true,
  playbackRate: 1,
  loop: { enabled: false, manual: false, start: 0, end: 15 },
  marks: [],
};

export class PostgresLearningProposalRepository implements LearningProposalRepository {
  constructor(private readonly pool: Pool) {}

  createFromVerifiedRun(ownerId: number, runId: string) {
    return transact(this.pool, async (client) => {
      const result = await client.query<{
        input: Record<string, unknown>;
        payload: unknown;
      }>(
        `
          SELECT run.input, item.payload
          FROM agent_runs AS run
          JOIN LATERAL (
            SELECT payload
            FROM agent_run_work_items
            WHERE run_id = run.id
              AND kind = 'proposed_step'
              AND status = 'completed'
            ORDER BY position
            LIMIT 1
          ) AS item ON true
          WHERE run.id = $1
            AND run.owner_id = $2
            AND run.state = 'awaiting_approval'
            AND EXISTS (
              SELECT 1 FROM agent_tool_calls AS call
              WHERE call.run_id = run.id
                AND call.tool_name = 'propose_next_learning'
                AND call.outcome = 'succeeded'
            )
          FOR UPDATE OF run
        `,
        [runId, ownerId],
      );
      const row = result.rows[0];
      if (!row) throw new LearningNotFoundError();
      const candidate = proposalCandidate(row.payload);
      let canonical;
      try {
        canonical = canonicalizeYoutubeUrl(candidate.videoUrl);
      } catch (error) {
        if (error instanceof InvalidYoutubeUrlError) {
          throw new LearningValidationError(
            'candidate',
            '검증된 YouTube 후보를 찾지 못했습니다.',
          );
        }
        throw error;
      }
      const source = await client.query<{ id: string }>(
        `
          INSERT INTO video_sources (
            provider, canonical_video_id, canonical_url, metadata
          )
          VALUES ('youtube', $1, $2, $3::jsonb)
          ON CONFLICT (provider, canonical_video_id) DO UPDATE
          SET metadata = video_sources.metadata || EXCLUDED.metadata,
              updated_at = statement_timestamp()
          RETURNING id::text AS id
        `,
        [
          canonical.canonicalVideoId,
          canonical.canonicalUrl,
          JSON.stringify({
            title: candidate.title,
            thumbnailUrl: candidate.thumbnailUrl,
            channelName: candidate.channelName,
          }),
        ],
      );
      const videoSourceId = source.rows[0]?.id;
      if (!videoSourceId) throw new LearningPersistenceUnavailableError();
      const reason =
        typeof row.input.objective === 'string'
          ? row.input.objective.slice(0, 500)
          : '현재 학습 기록과 이어지는 영상입니다.';
      const payload: ProposalPayload = {
        schemaVersion: 1,
        candidate: { ...candidate, videoUrl: canonical.canonicalUrl },
        reason,
        canonicalVideoId: canonical.canonicalVideoId,
      };
      const proposalId = randomUUID();
      const inserted = await client.query<ProposalRow>(
        `
          INSERT INTO learning_proposals (
            id, owner_id, agent_run_id, video_source_id,
            proposal_version, payload, payload_digest, expires_at
          )
          VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6,
                  statement_timestamp() + interval '7 days')
          ON CONFLICT (agent_run_id) DO NOTHING
          RETURNING ${proposalColumns()}
        `,
        [
          proposalId,
          ownerId,
          runId,
          videoSourceId,
          JSON.stringify(payload),
          digest(payload),
        ],
      );
      const existing =
        inserted.rows[0] ??
        (
          await client.query<ProposalRow>(
            `SELECT ${proposalColumns()} FROM learning_proposals
             WHERE agent_run_id = $1 AND owner_id = $2`,
            [runId, ownerId],
          )
        ).rows[0];
      if (!existing) throw new LearningPersistenceUnavailableError();
      return publicProposal(existing);
    });
  }

  findOwnerProposal(ownerId: number, proposalId: string) {
    return transact(this.pool, async (client) => {
      const row = await lockProposal(client, ownerId, proposalId);
      if (!row) return null;
      return publicProposal(await expireIfNeeded(client, row));
    });
  }

  async dismiss(ownerId: number, proposalId: string) {
    const result = await transact(this.pool, async (client) => {
      let row = await lockProposal(client, ownerId, proposalId);
      if (!row) throw new LearningNotFoundError();
      row = await expireIfNeeded(client, row);
      if (row.state === 'expired') return 'expired' as const;
      if (row.state === 'approved') {
        throw new LearningLifecycleError('이미 Course에 반영한 제안입니다.');
      }
      if (row.state === 'dismissed') return publicProposal(row);
      const updated = await client.query<ProposalRow>(
        `
          UPDATE learning_proposals
          SET state = 'dismissed', consumed_at = statement_timestamp(),
              dismissal_reason = 'USER_DISMISSED', updated_at = statement_timestamp()
          WHERE id = $1
          RETURNING ${proposalColumns()}
        `,
        [proposalId],
      );
      await finishRun(
        client,
        row.agentRunId,
        'cancelled',
        'proposal_dismissed',
      );
      return publicProposal(requiredRow(updated.rows[0]));
    });
    if (result === 'expired') throw new LearningProposalExpiredError();
    return result;
  }

  async approve(
    ownerId: number,
    proposalId: string,
    target: ProposalApprovalTarget,
  ) {
    const result = await transact(this.pool, async (client) => {
      let row = await lockProposal(client, ownerId, proposalId);
      if (!row) throw new LearningNotFoundError();
      row = await expireIfNeeded(client, row);
      const targetDigest = digest(target);
      if (row.state === 'approved') {
        if (row.approvalTargetDigest?.equals(targetDigest)) {
          return publicProposal(row);
        }
        throw new LearningLifecycleError(
          '이미 다른 Course 선택으로 반영한 제안입니다.',
        );
      }
      if (row.state === 'expired') return 'expired' as const;
      if (row.state === 'dismissed') throw new LearningProposalRejectedError();
      const payload = proposalPayload(row.payload);
      if (!row.payloadDigest.equals(digest(payload))) {
        throw new LearningLifecycleError(
          '제안 내용의 무결성을 확인하지 못했습니다.',
        );
      }

      const course = await resolveCourse(client, ownerId, target);
      const position = await nextPosition(client, course.id);
      const step = payload.candidate;
      const insertedStep = await client.query<{ id: string }>(
        `
          INSERT INTO course_steps (
            course_id, source_post_id, position,
            title_snapshot, video_url_snapshot,
            thumbnail_url_snapshot, channel_name_snapshot,
            owner_learning_state, evidence_source_url,
            evidence_timestamp_seconds, evidence_confidence,
            generation_status, duration_seconds, video_source_id,
            learning_context_provenance
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb,
                  $9, $10, $11, $12, $13, $14, $15::jsonb)
          RETURNING id::text AS id
        `,
        [
          course.id,
          step.sourcePostId,
          position,
          step.title,
          step.videoUrl,
          step.thumbnailUrl,
          step.channelName,
          JSON.stringify(DEFAULT_LEARNING_STATE),
          step.evidenceSourceUrl,
          step.evidenceTimestampSeconds,
          step.evidenceConfidence,
          step.status,
          step.durationSeconds,
          row.videoSourceId,
          JSON.stringify({ proposalId, proposalVersion: row.proposalVersion }),
        ],
      );
      const courseStepId = insertedStep.rows[0]?.id;
      if (!courseStepId) throw new LearningPersistenceUnavailableError();
      await createCourseOccurrence(
        client,
        ownerId,
        row.videoSourceId,
        courseStepId,
        proposalId,
      );
      const courseVersion = course.created
        ? course.version
        : course.version + 1;
      if (!course.created) {
        await client.query(
          `UPDATE courses
           SET version = $2, updated_at = statement_timestamp()
           WHERE id = $1`,
          [course.id, courseVersion],
        );
      }
      await enqueueRetrieval(
        client,
        ownerId,
        course.id,
        courseVersion,
        courseStepId,
      );
      const approved = await client.query<ProposalRow>(
        `
          UPDATE learning_proposals
          SET state = 'approved', consumed_at = statement_timestamp(),
              approved_course_id = $2, approved_course_version = $3,
              approval_target_digest = $4, updated_at = statement_timestamp()
          WHERE id = $1
          RETURNING ${proposalColumns()}
        `,
        [proposalId, course.id, courseVersion, targetDigest],
      );
      await finishRun(client, row.agentRunId, 'completed', 'proposal_approved');
      return publicProposal(requiredRow(approved.rows[0]));
    });
    if (result === 'expired') throw new LearningProposalExpiredError();
    return result;
  }
}

async function resolveCourse(
  client: PoolClient,
  ownerId: number,
  target: ProposalApprovalTarget,
) {
  if (target.kind === 'new_private_course') {
    const inserted = await client.query<{ id: number; version: number }>(
      `
        INSERT INTO courses (owner_id, title, description, visibility, status)
        VALUES ($1, $2, '', 'private', 'draft')
        RETURNING id, version
      `,
      [ownerId, target.title],
    );
    const row = inserted.rows[0];
    if (!row) throw new LearningPersistenceUnavailableError();
    return { ...row, created: true };
  }
  const selected = await client.query<{
    id: number;
    version: number;
    status: string;
  }>(
    `SELECT id, version, status FROM courses
     WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
    [target.courseId, ownerId],
  );
  const row = selected.rows[0];
  if (!row) throw new LearningNotFoundError();
  if (row.status === 'archived') {
    throw new LearningLifecycleError(
      '보관한 Course에는 영상을 추가할 수 없습니다.',
    );
  }
  if (row.version !== target.expectedCourseVersion) {
    throw new LearningVersionConflictError(
      target.expectedCourseVersion,
      row.version,
    );
  }
  return { ...row, created: false };
}

async function nextPosition(client: PoolClient, courseId: number) {
  const result = await client.query<{ position: number }>(
    `SELECT count(*)::integer + 1 AS position FROM course_steps WHERE course_id = $1`,
    [courseId],
  );
  const position = result.rows[0]?.position ?? 1;
  if (position > 200) {
    throw new LearningValidationError(
      'target',
      'Course에는 영상 200개까지 추가할 수 있습니다.',
    );
  }
  return position;
}

async function createCourseOccurrence(
  client: PoolClient,
  ownerId: number,
  videoSourceId: string,
  courseStepId: string,
  proposalId: string,
) {
  const item = await client.query<{ id: string }>(
    `
      INSERT INTO learning_items (user_id, video_source_id, provenance)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (user_id, video_source_id) DO UPDATE
      SET updated_at = statement_timestamp()
      RETURNING id::text AS id
    `,
    [ownerId, videoSourceId, JSON.stringify({ proposalId })],
  );
  const learningItemId = item.rows[0]?.id;
  if (!learningItemId) throw new LearningPersistenceUnavailableError();
  await client.query(
    `
      INSERT INTO study_contexts (
        user_id, learning_item_id, kind, course_step_id,
        course_step_provenance_id, provenance
      )
      VALUES ($1, $2, 'course_occurrence', $3, $3, $4::jsonb)
    `,
    [ownerId, learningItemId, courseStepId, JSON.stringify({ proposalId })],
  );
}

async function enqueueRetrieval(
  client: PoolClient,
  ownerId: number,
  courseId: number,
  courseVersion: number,
  courseStepId: string,
) {
  const payload = {
    sourceKind: 'course_step',
    sourceId: courseStepId,
    courseStepId,
    sourceVersion: String(courseVersion),
    courseId,
  };
  await client.query(
    `
      INSERT INTO work_outbox_events (
        id, owner_id, event_type, aggregate_type, aggregate_id,
        aggregate_version, payload_schema_version, payload, trace_context
      )
      VALUES ($1, $2, 'retrieval_embedding.requested', 'course_step', $3,
              $4, 1, $5::jsonb, '{}'::jsonb)
    `,
    [
      randomUUID(),
      ownerId,
      courseStepId,
      courseVersion,
      JSON.stringify(payload),
    ],
  );
}

async function finishRun(
  client: PoolClient,
  runId: string,
  state: 'completed' | 'cancelled',
  reasonCode: string,
) {
  const updated = await client.query<{ version: number; previous: string }>(
    `
      UPDATE agent_runs
      SET state = $2, version = version + 1,
          finished_at = COALESCE(finished_at, statement_timestamp()),
          updated_at = statement_timestamp()
      WHERE id = $1 AND state = 'awaiting_approval'
      RETURNING version, 'awaiting_approval'::text AS previous
    `,
    [runId, state],
  );
  const run = updated.rows[0];
  if (!run) return;
  await client.query(
    `
      INSERT INTO agent_run_state_transitions (
        run_id, from_state, to_state, run_version, reason_code, actor_kind
      )
      VALUES ($1, $2, $3, $4, $5, 'user')
    `,
    [runId, run.previous, state, run.version, reasonCode],
  );
}

async function lockProposal(
  client: PoolClient,
  ownerId: number,
  proposalId: string,
) {
  const result = await client.query<ProposalRow>(
    `SELECT ${proposalColumns()} FROM learning_proposals
     WHERE id = $1 AND owner_id = $2 FOR UPDATE`,
    [proposalId, ownerId],
  );
  return result.rows[0] ?? null;
}

async function expireIfNeeded(client: PoolClient, row: ProposalRow) {
  if (row.state !== 'pending' || row.expiresAt.getTime() > Date.now()) {
    return row;
  }
  const result = await client.query<ProposalRow>(
    `
      UPDATE learning_proposals
      SET state = 'expired', consumed_at = statement_timestamp(),
          updated_at = statement_timestamp()
      WHERE id = $1 AND state = 'pending'
      RETURNING ${proposalColumns()}
    `,
    [row.id],
  );
  return result.rows[0] ?? row;
}

function proposalColumns() {
  return `id, owner_id AS "ownerId", agent_run_id AS "agentRunId",
    video_source_id::text AS "videoSourceId",
    proposal_version AS "proposalVersion", state, payload,
    payload_digest AS "payloadDigest", expires_at AS "expiresAt",
    approved_course_id AS "approvedCourseId",
    approved_course_version AS "approvedCourseVersion",
    approval_target_digest AS "approvalTargetDigest"`;
}

function proposalCandidate(value: unknown): ProposedCourseStep {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningValidationError('candidate', '검증된 후보가 없습니다.');
  }
  const candidate = value as Partial<ProposedCourseStep>;
  if (
    candidate.status !== 'ready' ||
    typeof candidate.title !== 'string' ||
    !candidate.title.trim() ||
    typeof candidate.videoUrl !== 'string' ||
    typeof candidate.thumbnailUrl !== 'string' ||
    typeof candidate.channelName !== 'string' ||
    typeof candidate.evidenceSourceUrl !== 'string' ||
    !Number.isInteger(candidate.evidenceTimestampSeconds) ||
    !Number.isFinite(candidate.evidenceConfidence) ||
    !Number.isInteger(candidate.durationSeconds) ||
    Number(candidate.durationSeconds) <= 0 ||
    (candidate.sourcePostId !== null &&
      (!Number.isSafeInteger(candidate.sourcePostId) ||
        Number(candidate.sourcePostId) <= 0))
  ) {
    throw new LearningValidationError('candidate', '검증된 후보가 없습니다.');
  }
  return candidate as ProposedCourseStep;
}

function proposalPayload(value: unknown): ProposalPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearningLifecycleError(
      '제안 내용의 무결성을 확인하지 못했습니다.',
    );
  }
  const payload = value as Partial<ProposalPayload>;
  if (
    payload.schemaVersion !== 1 ||
    typeof payload.reason !== 'string' ||
    typeof payload.canonicalVideoId !== 'string'
  ) {
    throw new LearningLifecycleError(
      '제안 내용의 무결성을 확인하지 못했습니다.',
    );
  }
  proposalCandidate(payload.candidate);
  return payload as ProposalPayload;
}

function publicProposal(row: ProposalRow): LearningProposal {
  const payload = proposalPayload(row.payload);
  return {
    id: row.id,
    ownerId: row.ownerId,
    agentRunId: row.agentRunId,
    videoSourceId: row.videoSourceId,
    proposalVersion: row.proposalVersion,
    state: row.state,
    candidate: {
      title: payload.candidate.title,
      videoUrl: payload.candidate.videoUrl,
      thumbnailUrl: payload.candidate.thumbnailUrl,
      channelName: payload.candidate.channelName,
      reason: payload.reason,
    },
    expiresAt: row.expiresAt.toISOString(),
    approvedCourseId: row.approvedCourseId,
    approvedCourseVersion: row.approvedCourseVersion,
  };
}

function digest(value: unknown) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requiredRow<T>(row: T | undefined): T {
  if (!row) throw new LearningPersistenceUnavailableError();
  return row;
}

async function transact<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if (
      error instanceof LearningNotFoundError ||
      error instanceof LearningValidationError ||
      error instanceof LearningVersionConflictError ||
      error instanceof LearningLifecycleError ||
      error instanceof LearningProposalExpiredError ||
      error instanceof LearningProposalRejectedError
    ) {
      throw error;
    }
    throw new LearningPersistenceUnavailableError({ cause: error });
  } finally {
    client.release();
  }
}
