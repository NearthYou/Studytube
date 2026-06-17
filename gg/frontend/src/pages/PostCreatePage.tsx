import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Save } from 'lucide-react';
import { createPost } from '../api/posts';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function PostCreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [bodyPart, setBodyPart] = useState('');
  const [memo, setMemo] = useState('');
  const [tags, setTags] = useState('');
  const [exerciseName, setExerciseName] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [targetReps, setTargetReps] = useState('');
  const [set1Reps, setSet1Reps] = useState('');
  const [set2Reps, setSet2Reps] = useState('');
  const [set3Reps, setSet3Reps] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    try {
      const post = await createPost({
        title,
        date,
        bodyPart,
        memo,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        exercises: [
          {
            exerciseName,
            weightKg: Number(weightKg),
            targetReps: targetReps ? Number(targetReps) : undefined,
            sets: [
              { setNumber: 1, reps: Number(set1Reps) },
              { setNumber: 2, reps: Number(set2Reps) },
              { setNumber: 3, reps: Number(set3Reps) },
            ],
          },
        ],
      });

      navigate(`/posts/${post.id}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : '게시글 작성에 실패했습니다.');
    }
  }

  return (
    <div>
      <PageHeader
        title="운동 기록 작성"
        description="오늘 한 운동을 표 형태로 정리해 저장합니다."
      />

      <form className="space-y-6" onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>기본 정보</CardTitle>
            <CardDescription>게시글 제목과 운동 날짜, 부위를 입력합니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="title">제목</Label>
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="오늘 가슴 운동"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date">운동 날짜</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bodyPart">운동 부위</Label>
              <Input
                id="bodyPart"
                value={bodyPart}
                onChange={(event) => setBodyPart(event.target.value)}
                placeholder="가슴"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="memo">메모</Label>
              <Textarea
                id="memo"
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="마지막 세트가 힘들었다."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>운동 기록</CardTitle>
            <CardDescription>
              이번 MVP에서는 한 가지 운동의 3세트 기록을 먼저 입력합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-3">
                <Label htmlFor="exerciseName">운동명</Label>
                <Input
                  id="exerciseName"
                  value={exerciseName}
                  onChange={(event) => setExerciseName(event.target.value)}
                  placeholder="벤치프레스"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="weightKg">무게 kg</Label>
                <Input
                  id="weightKg"
                  value={weightKg}
                  onChange={(event) => setWeightKg(event.target.value)}
                  placeholder="60"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="targetReps">목표 반복 수</Label>
                <Input
                  id="targetReps"
                  value={targetReps}
                  onChange={(event) => setTargetReps(event.target.value)}
                  placeholder="8"
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-2 bg-muted px-4 py-2 text-xs font-medium text-muted-foreground">
                <span>세트</span>
                <span>반복 수</span>
              </div>
              {[
                { label: '1세트', value: set1Reps, onChange: setSet1Reps },
                { label: '2세트', value: set2Reps, onChange: setSet2Reps },
                { label: '3세트', value: set3Reps, onChange: setSet3Reps },
              ].map((set) => (
                <div
                  key={set.label}
                  className="grid grid-cols-2 items-center gap-4 border-t border-border px-4 py-3"
                >
                  <span className="text-sm font-medium">{set.label}</span>
                  <Input
                    value={set.value}
                    onChange={(event) => set.onChange(event.target.value)}
                    placeholder="8"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>태그</CardTitle>
            <CardDescription>쉼표로 구분해 입력합니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="tags">태그</Label>
            <Input
              id="tags"
              className="mt-2"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="가슴, 벤치프레스, 증량도전"
            />
          </CardContent>
        </Card>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit">
            <Save className="h-4 w-4" />
            저장하기
          </Button>
        </div>
      </form>
    </div>
  );
}
