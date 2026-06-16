import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Bot, ChevronLeft, Play, Trash2 } from 'lucide-react';
import { analyzePost, createComment, deleteComment, getPost } from '../api/posts';
import type { AnalysisResult } from '../types/analysis';
import type { Post } from '../types/post';
import { PageHeader } from '@/components/PageHeader';
import { TagBadge } from '@/components/TagBadge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { formatDate, formatDateTime } from '@/lib/format';

export default function PostDetailPage() {
  const params = useParams();
  const postId = Number(params.id);
  const [post, setPost] = useState<Post | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [commentContent, setCommentContent] = useState('');
  const [error, setError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [commentError, setCommentError] = useState('');

  useEffect(() => {
    async function loadPost() {
      try {
        const data = await getPost(postId);
        setPost(data);
      } catch (error) {
        setError(error instanceof Error ? error.message : '게시글 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    }

    loadPost();
  }, [postId]);

  async function handleAnalyze() {
    setIsAnalyzing(true);
    setAnalysisError('');

    try {
      const result = await analyzePost(postId);
      setAnalysis(result);
    } catch (error) {
      setAnalysisError(
        error instanceof Error ? error.message : 'AI 분석에 실패했습니다.',
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleCreateComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCommentError('');

    try {
      const comment = await createComment(postId, {
        content: commentContent,
      });

      setPost((currentPost) =>
        currentPost
          ? {
              ...currentPost,
              comments: [...currentPost.comments, comment],
            }
          : currentPost,
      );
      setCommentContent('');
    } catch (error) {
      setCommentError(
        error instanceof Error ? error.message : '댓글 작성에 실패했습니다.',
      );
    }
  }

  async function handleDeleteComment(commentId: number) {
    setCommentError('');

    try {
      await deleteComment(postId, commentId);
      setPost((currentPost) =>
        currentPost
          ? {
              ...currentPost,
              comments: currentPost.comments.filter(
                (comment) => comment.id !== commentId,
              ),
            }
          : currentPost,
      );
    } catch (error) {
      setCommentError(
        error instanceof Error ? error.message : '댓글 삭제에 실패했습니다.',
      );
    }
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">게시글을 불러오는 중입니다.</div>;
  }

  if (!post) {
    return <div className="text-sm text-muted-foreground">{error || '게시글을 찾을 수 없습니다.'}</div>;
  }

  return (
    <div>
      <PageHeader
        title={post.title}
        description={`${post.author.nickname} · ${formatDate(post.date)} · ${post.bodyPart}`}
        actions={
          <Button asChild variant="outline">
            <Link to="/posts">
              <ChevronLeft className="h-4 w-4" />
              목록
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>기록 정보</CardTitle>
              <CardDescription>운동 부위와 메모, 태그를 확인합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">작성자</div>
                  <div className="mt-1 font-medium">{post.author.nickname}</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">운동 날짜</div>
                  <div className="mt-1 font-medium">{formatDate(post.date)}</div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">운동 부위</div>
                  <div className="mt-1 font-medium">{post.bodyPart}</div>
                </div>
              </div>

              {post.memo && (
                <div className="rounded-lg border border-border p-4 text-sm leading-6">
                  {post.memo}
                </div>
              )}

              {post.postTags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {post.postTags.map((postTag) => (
                    <TagBadge key={postTag.tagId} name={postTag.tag.name} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>운동 기록</CardTitle>
              <CardDescription>운동별 무게, 목표 반복 수, 세트 기록입니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {post.exercises.map((exercise) => (
                <div key={exercise.id} className="overflow-hidden rounded-lg border border-border">
                  <div className="flex flex-col gap-1 bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold">{exercise.exerciseName}</h3>
                      <p className="text-sm text-muted-foreground">
                        {exercise.weightKg}kg
                        {exercise.targetReps && ` · 목표 ${exercise.targetReps}회`}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 border-t border-border bg-background px-4 py-2 text-xs font-medium text-muted-foreground">
                    <span>세트</span>
                    <span>반복 수</span>
                  </div>
                  {exercise.sets.map((set) => (
                    <div
                      key={set.id}
                      className="grid grid-cols-2 border-t border-border px-4 py-3 text-sm"
                    >
                      <span>{set.setNumber}세트</span>
                      <span>{set.reps}회</span>
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>댓글</CardTitle>
              <CardDescription>응원이나 피드백을 남깁니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form className="space-y-3" onSubmit={handleCreateComment}>
                <Textarea
                  value={commentContent}
                  onChange={(event) => setCommentContent(event.target.value)}
                  placeholder="응원이나 피드백을 남겨보세요."
                />
                <div className="flex justify-end">
                  <Button type="submit" disabled={!commentContent.trim()}>
                    댓글 작성
                  </Button>
                </div>
              </form>

              {commentError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {commentError}
                </p>
              )}

              {post.comments.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  아직 댓글이 없습니다.
                </p>
              ) : (
                <div className="space-y-3">
                  {post.comments.map((comment) => (
                    <div key={comment.id} className="rounded-lg border border-border p-4">
                      <p className="text-sm leading-6">{comment.content}</p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {comment.author.nickname} · {formatDateTime(comment.createdAt)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteComment(comment.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          삭제
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-8 xl:self-start">
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                AI 분석
              </CardTitle>
              <CardDescription>
                이전 운동 기록과 비교해 다음 목표를 추천합니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button className="w-full" type="button" onClick={handleAnalyze} disabled={isAnalyzing}>
                <Play className="h-4 w-4" />
                {isAnalyzing ? '분석 중...' : 'AI 분석'}
              </Button>

              {analysisError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {analysisError}
                </p>
              )}

              {!analysis && (
                <p className="rounded-lg border border-dashed border-border p-4 text-sm leading-6 text-muted-foreground">
                  버튼을 누르면 RAG, MCP-style tool, Agent workflow 결과가 이 패널에 표시됩니다.
                </p>
              )}

              {analysis && (
                <div className="space-y-5">
                  <section>
                    <h3 className="text-sm font-semibold">요약</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {analysis.summary}
                    </p>
                  </section>
                  <Separator />
                  <section>
                    <h3 className="text-sm font-semibold">추천</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {analysis.recommendation}
                    </p>
                  </section>
                  <section className="rounded-lg bg-primary/10 p-4">
                    <h3 className="text-sm font-semibold text-primary">다음 목표</h3>
                    <p className="mt-2 text-sm leading-6">{analysis.nextGoal}</p>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold">분석 근거</h3>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {analysis.basis.map((basis) => (
                        <li key={basis}>- {basis}</li>
                      ))}
                    </ul>
                  </section>

                  {analysis.referencedPosts.length > 0 && (
                    <section>
                      <h3 className="text-sm font-semibold">참고한 이전 기록</h3>
                      <div className="mt-2 space-y-2">
                        {analysis.referencedPosts.map((referencedPost) => (
                          <div
                            key={referencedPost.id}
                            className="rounded-md border border-border p-3 text-sm"
                          >
                            <div className="font-medium">{referencedPost.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {referencedPost.date}
                              {referencedPost.matchedExercises.length > 0 &&
                                ` · ${referencedPost.matchedExercises.join(', ')}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {analysis.workflowSteps.length > 0 && (
                    <section>
                      <h3 className="text-sm font-semibold">Agent workflow</h3>
                      <ol className="mt-2 space-y-2 text-sm text-muted-foreground">
                        {analysis.workflowSteps.map((step) => (
                          <li key={step.step}>
                            {step.step}. {step.name} - {step.status}
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}

                  {analysis.toolCalls.length > 0 && (
                    <section>
                      <h3 className="text-sm font-semibold">MCP-style toolCalls</h3>
                      <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                        {analysis.toolCalls.map((toolCall) => (
                          <div
                            key={`${toolCall.toolName}-${toolCall.input}`}
                            className="rounded-md bg-muted p-3"
                          >
                            {toolCall.input} → {toolCall.output}
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <p className="text-xs text-muted-foreground">
                    참고 기록 {analysis.referencedPostCount}개 · {analysis.analysisMode}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
