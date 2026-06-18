import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function AboutPage() {
  return (
    <div>
      <PageHeader
        title="프로젝트 소개"
        description="AI 운동 기록 인증 게시판은 운동 초보자가 기록을 남기고 다음 목표를 확인하는 학습용 서비스입니다."
      />
      <Card>
        <CardHeader>
          <CardTitle>핵심 아이디어</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-7 text-muted-foreground">
          운동 기록을 게시글로 남기면 AI가 이전 기록과 비교해 점진적 과부하 관점에서
          다음 운동 목표를 추천합니다. 전문 의학 조언이 아니라 꾸준한 기록과 성장 확인에
          집중합니다.
        </CardContent>
      </Card>
    </div>
  );
}

export default AboutPage;
