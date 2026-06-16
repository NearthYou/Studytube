import type { User } from './auth';

export type ExerciseSet = {
  id: number;
  setNumber: number;
  reps: number;
  perceivedDifficulty?: number;
};

export type Exercise = {
  id: number;
  exerciseName: string;
  normalizedName?: string;
  weightKg: number;
  targetReps?: number;
  orderIndex: number;
  memo?: string;
  sets: ExerciseSet[];
};

export type Comment = {
  id: number;
  postId: number;
  authorId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
  author: User;
};

export type Tag = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type PostTag = {
  postId: number;
  tagId: number;
  tag: Tag;
};

export type Post = {
  id: number;
  authorId: number;
  title: string;
  date: string;
  bodyPart: string;
  memo?: string;
  createdAt: string;
  updatedAt: string;
  author: User;
  exercises: Exercise[];
  comments: Comment[];
  postTags: PostTag[];
};

export type PostListResponse = {
  items: Post[];
  totalCount: number;
  limit: number;
  offset: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export type CreatePostRequest = {
  title: string;
  date: string;
  bodyPart: string;
  memo?: string;
  exercises: {
    exerciseName: string;
    weightKg: number;
    targetReps?: number;
    sets: {
      setNumber: number;
      reps: number;
      perceivedDifficulty?: number;
    }[];
  }[];
  tags?: string[];
};

export type CreateCommentRequest = {
  content: string;
};
