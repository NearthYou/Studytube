import { Link } from 'react-router';
import { ArrowRight, Bot, ClipboardList, Dumbbell, History } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const summaryCards = [
  {
    title: '운동 기록',
    description: '게시글처럼 오늘 운동을 남깁니다.',
    icon: ClipboardList,
  },
  {
    title: '이전 기록 비교',
    description: '같은 운동의 과거 기록을 찾아 비교합니다.',
    icon: History,
  },
  {
    title: 'AI 목표 추천',
    description: '다음 운동에서 채울 목표를 정리합니다.',
    icon: Bot,
  },
];

export default function HomePage() {
  return (
    <div>
      <PageHeader
        title="운동 기록 대시보드"
        description="오늘의 운동 기록을 남기고, 이전 기록과 비교해 다음 목표를 확인합니다."
        actions={
          <Button asChild>
            <Link to="/posts/new">
              기록 작성
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <section className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <card.icon className="h-5 w-5" />
              </div>
              <CardTitle>{card.title}</CardTitle>
              <CardDescription>{card.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Dumbbell className="h-5 w-5 text-primary" />
            점진적 과부하 흐름
          </CardTitle>
          <CardDescription>
            이 서비스의 핵심은 기록을 저장하는 것보다 다음 행동으로 연결하는 것입니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-4">
            {['기록 작성', '이전 기록 검색', 'AI 분석', '다음 목표 확인'].map(
              (step, index) => (
                <div key={step} className="rounded-lg border border-border bg-muted/40 p-4">
                  <div className="mb-2 text-xs font-semibold text-primary">
                    STEP {index + 1}
                  </div>
                  <div className="font-medium text-foreground">{step}</div>
                </div>
              ),
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
