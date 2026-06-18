import { apiRequest, getStoredToken } from './client';
import type { AnalysisResult } from '../types/analysis';
import type {
  Comment,
  CreateCommentRequest,
  CreatePostRequest,
  Post,
  PostListResponse,
} from '../types/post';

type GetPostsParams = {
  keyword?: string;
  limit?: number;
  offset?: number;
};

export function getPosts(params: GetPostsParams = {}) {
  const searchParams = new URLSearchParams();
  const trimmedKeyword = params.keyword?.trim();

  searchParams.set('limit', String(params.limit ?? 10));
  searchParams.set('offset', String(params.offset ?? 0));

  if (trimmedKeyword) {
    searchParams.set('keyword', trimmedKeyword);
  }

  return apiRequest<PostListResponse>(`/posts?${searchParams.toString()}`);
}

export function getPost(id: number) {
  return apiRequest<Post>(`/posts/${id}`);
}

export function createPost(data: CreatePostRequest) {
  return apiRequest<Post>('/posts', {
    method: 'POST',
    body: data,
    token: getStoredToken(),
  });
}

export function analyzePost(id: number) {
  return apiRequest<AnalysisResult>(`/posts/${id}/analyze`, {
    method: 'POST',
    token: getStoredToken(),
  });
}

export function createComment(postId: number, data: CreateCommentRequest) {
  return apiRequest<Comment>(`/posts/${postId}/comments`, {
    method: 'POST',
    body: data,
    token: getStoredToken(),
  });
}

export function deleteComment(postId: number, commentId: number) {
  return apiRequest<{ deleted: boolean; id: number }>(
    `/posts/${postId}/comments/${commentId}`,
    {
      method: 'DELETE',
      token: getStoredToken(),
    },
  );
}
