import type { Pool } from 'pg';
import type {
  CreateLearningNoteCommand,
  LearningNote,
  LearningNoteRepository,
  UpdateLearningNoteCommand,
} from './learning-note.repository';

type NoteRow = LearningNote;

const RETURNING = `
  RETURNING id::text AS id, user_id AS "userId",
            study_context_id::text AS "studyContextId",
            position_seconds::float8 AS "positionSeconds", body,
            created_at AS "createdAt", updated_at AS "updatedAt"
`;

export class PostgresLearningNoteRepository implements LearningNoteRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    command: CreateLearningNoteCommand,
  ): Promise<LearningNote | null> {
    validateId(command.userId, 'userId');
    validateDecimalId(command.studyContextId, 'studyContextId');
    const body = validateBody(command.body);
    if (
      !Number.isFinite(command.positionSeconds) ||
      command.positionSeconds < 0
    ) {
      throw new RangeError('positionSeconds must be non-negative');
    }
    const result = await this.pool.query<NoteRow>(
      `INSERT INTO learning_notes (user_id, study_context_id, position_seconds, body)
       SELECT $1, context.id, $3, $4
       FROM study_contexts AS context
       WHERE context.user_id = $1 AND context.id = $2::bigint
       ${RETURNING}`,
      [command.userId, command.studyContextId, command.positionSeconds, body],
    );
    return result.rows[0] ?? null;
  }

  async update(
    command: UpdateLearningNoteCommand,
  ): Promise<LearningNote | null> {
    validateId(command.userId, 'userId');
    validateDecimalId(command.studyContextId, 'studyContextId');
    validateDecimalId(command.noteId, 'noteId');
    const result = await this.pool.query<NoteRow>(
      `UPDATE learning_notes
       SET body = $4, updated_at = statement_timestamp()
       WHERE user_id = $1 AND study_context_id = $2::bigint AND id = $3::bigint
       ${RETURNING}`,
      [
        command.userId,
        command.studyContextId,
        command.noteId,
        validateBody(command.body),
      ],
    );
    return result.rows[0] ?? null;
  }

  async delete(
    userId: number,
    studyContextId: string,
    noteId: string,
  ): Promise<boolean> {
    validateId(userId, 'userId');
    validateDecimalId(studyContextId, 'studyContextId');
    validateDecimalId(noteId, 'noteId');
    const result = await this.pool.query(
      `DELETE FROM learning_notes
       WHERE user_id = $1 AND study_context_id = $2::bigint AND id = $3::bigint`,
      [userId, studyContextId, noteId],
    );
    return result.rowCount === 1;
  }
}

function validateId(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1)
    throw new RangeError(`${name} is invalid`);
}

function validateDecimalId(value: string, name: string): void {
  if (!/^[1-9]\d*$/u.test(value)) throw new RangeError(`${name} is invalid`);
}

function validateBody(value: string): string {
  const body = value.trim();
  if (!body || body.length > 4_000) throw new RangeError('body is invalid');
  return body;
}
