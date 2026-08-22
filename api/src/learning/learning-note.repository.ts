export const LEARNING_NOTE_REPOSITORY = Symbol('LEARNING_NOTE_REPOSITORY');

export type LearningNote = Readonly<{
  id: string;
  userId: number;
  studyContextId: string;
  positionSeconds: number;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateLearningNoteCommand = Readonly<{
  userId: number;
  studyContextId: string;
  positionSeconds: number;
  body: string;
}>;

export type UpdateLearningNoteCommand = Readonly<{
  userId: number;
  studyContextId: string;
  noteId: string;
  body: string;
}>;

export interface LearningNoteRepository {
  create(command: CreateLearningNoteCommand): Promise<LearningNote | null>;
  update(command: UpdateLearningNoteCommand): Promise<LearningNote | null>;
  delete(
    userId: number,
    studyContextId: string,
    noteId: string,
  ): Promise<boolean>;
}
