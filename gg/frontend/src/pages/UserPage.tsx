import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function UserPage() {
  return (
    <div>
      <PageHeader
        title="내 정보"
        description="현재는 로그인 사용자의 기본 정보 확인 흐름을 위한 자리입니다."
      />
      <Card>
        <CardHeader>
          <CardTitle>계정 정보</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          로그인 후 내 정보 API와 연결해 확장할 수 있습니다.
        </CardContent>
      </Card>
    </div>
  );
}

export default UserPage;
