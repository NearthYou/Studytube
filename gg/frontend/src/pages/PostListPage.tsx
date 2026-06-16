import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { CalendarDays, Dumbbell, PenLine, Search, UserRound } from 'lucide-react';
import { getPosts } from '../api/posts';
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
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/format';

export default function PostListPage() {
  const pageSize = 10;
  const [posts, setPosts] = useState<Post[]>([]);
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadPosts() {
      setIsLoading(true);
      setError('');

      try {
        const data = await getPosts({
          keyword: submittedKeyword,
          limit: pageSize,
          offset,
        });
        setPosts(data.items);
        setTotalCount(data.totalCount);
        setHasNext(data.hasNext);
        setHasPrevious(data.hasPrevious);
      } catch (error) {
        setError(error instanceof Error ? error.message : '게시글 목록 조회에 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    }

    loadPosts();
  }, [offset, submittedKeyword]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedKeyword(keyword);
    setOffset(0);
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">게시글을 불러오는 중입니다.</div>;
  }

  return (
    <div>
      <PageHeader
        title="운동 기록"
        description="게시글처럼 남긴 운동 기록을 검색하고 AI 분석으로 이어갑니다."
        actions={
          <Button asChild>
            <Link to="/posts/new">
              <PenLine className="h-4 w-4" />
              기록 작성
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>기록 목록</CardTitle>
            <CardDescription>
              전체 {totalCount}개 중 {posts.length > 0 ? offset + 1 : 0}
              {posts.length > 0 && `-${offset + posts.length}`}번째 기록
            </CardDescription>
          </div>

          <form className="flex w-full gap-2 sm:max-w-sm" onSubmit={handleSearch}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="제목 또는 운동명 검색"
              />
            </div>
            <Button type="submit" variant="secondary">
              검색
            </Button>
          </form>
        </CardHeader>

        <CardContent>
          {error && (
            <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          {posts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm font-medium">아직 표시할 운동 기록이 없습니다.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                첫 기록을 작성하면 이곳에서 목록을 확인할 수 있습니다.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <Link
                  key={post.id}
                  to={`/posts/${post.id}`}
                  className="block rounded-lg border border-border bg-background p-4 transition-colors hover:bg-accent/60"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold">{post.title}</h2>
                        <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {post.bodyPart}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <UserRound className="h-3.5 w-3.5" />
                          {post.author.nickname}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5" />
                          {formatDate(post.date)}
                        </span>
                        {post.exercises[0] && (
                          <span className="inline-flex items-center gap-1">
                            <Dumbbell className="h-3.5 w-3.5" />
                            {post.exercises[0].exerciseName}
                          </span>
                        )}
                      </div>
                    </div>

                    {post.postTags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 lg:max-w-xs lg:justify-end">
                        {post.postTags.map((postTag) => (
                          <TagBadge key={postTag.tagId} name={postTag.tag.name} />
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={!hasPrevious}
              onClick={() => setOffset(Math.max(offset - pageSize, 0))}
            >
              이전
            </Button>
            <span className="text-sm text-muted-foreground">
              {Math.floor(offset / pageSize) + 1}페이지
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={!hasNext}
              onClick={() => setOffset(offset + pageSize)}
            >
              다음
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
