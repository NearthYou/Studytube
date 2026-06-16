# 2026년 6월 13일 토요일 학습 문서

> 주제: FastAPI AI 서버 연결, NestJS에서 AI 서버 호출, 게시글 상세 화면에 AI 분석 버튼 붙이기  
> 목표: 게시글 상세 화면에서 `AI 분석` 버튼을 누르면 FastAPI AI 서버까지 요청이 갔다가 분석 결과가 화면에 표시되게 만든다.

---

# 0. 구현 전에 먼저 잡을 그림

아직 코드를 치지 말고, 오늘 만들 장면부터 먼저 잡는다.

금요일까지는 이 흐름을 만들었다.

```text
React 화면
-> NestJS 백엔드
-> PostgreSQL DB
```

예를 들면:

```text
게시글 작성 버튼 클릭
-> React가 NestJS에 요청
-> NestJS가 DB에 저장
-> 저장된 게시글을 화면에 표시
```

토요일에는 여기에 **AI 서버**가 하나 더 붙는다.

```text
React 화면
-> NestJS 백엔드
-> FastAPI AI 서버
-> NestJS 백엔드
-> React 화면
```

오늘 만들 장면은 딱 이것이다.

```text
게시글 상세 화면에서
"AI 분석" 버튼을 누른다.
        ↓
화면에 요약, 추천, 다음 목표가 나온다.
```

오늘은 진짜 똑똑한 AI를 만드는 날이 아니다.

오늘은 먼저 **길을 뚫는 날**이다.

```text
React가 NestJS를 부르고,
NestJS가 FastAPI를 부르고,
FastAPI가 분석 결과를 돌려주고,
React가 그 결과를 화면에 보여준다.
```

이 0번 예열은 뒤의 작업 전체와 연결된다.

| 지금 이해할 말 | 뒤에서 실제로 하는 번호 |
| --- | --- |
| FastAPI AI 서버가 분석 결과를 만든다 | 4번, 5번, 6번, 7번, 8번 |
| NestJS가 FastAPI를 호출한다 | 9번, 10번, 11번, 12번, 13번, 14번, 15번, 16번 |
| React가 분석 버튼을 누르고 결과를 보여준다 | 17번, 18번, 19번 |
| 마지막에 전체 흐름을 확인한다 | 20번, 21번, 22번, 23번 |

---

# 1. 오늘 작업을 사람 역할로 이해하기

오늘은 서버가 여러 개라서 헷갈린다.

그래서 사람 역할로 나누면 쉽다.

```text
React
-> 사용자와 직접 만나는 직원

NestJS
-> 로그인 확인하고 DB를 보는 매니저

FastAPI
-> 운동 기록을 분석하는 AI 담당자
```

게시글 상세 화면에서 사용자가 `AI 분석` 버튼을 누르면 이렇게 움직인다.

```text
사용자:
이 운동 기록 분석해줘.

React:
NestJS야, 이 게시글 분석해줘.

NestJS:
잠깐. 이 사용자 로그인했나?
이 글 작성자가 맞나?
DB에서 현재 글이랑 이전 기록 좀 찾아볼게.
FastAPI야, 이 운동 기록 분석해줘.

FastAPI:
요약과 다음 목표를 만들었어.

NestJS:
React야, 결과 여기 있어.

React:
화면에 보여줄게.
```

이 역할 분담을 알아야 뒤 코드가 덜 이상하게 보인다.

이 1번 예열은 뒤의 작업과 이렇게 연결된다.

| 역할 | 실제 파일 | 뒤에서 하는 번호 |
| --- | --- | --- |
| FastAPI, AI 담당자 | `ai-server/app/...` | 4번 ~ 8번 |
| NestJS, 중간 매니저 | `backend/src/ai`, `backend/src/posts` | 9번 ~ 16번 |
| React, 화면 직원 | `frontend/src/api`, `PostDetailPage.tsx` | 17번 ~ 19번 |

---

# 2. 오늘 작업을 3층으로 나누기

오늘 작업은 한 번에 보면 복잡하다.

그래서 아래 3층으로 나눠서 보면 된다.

```text
1층: FastAPI
2층: NestJS
3층: React
```

순서는 반드시 아래처럼 가는 게 좋다.

```text
1. FastAPI 혼자 잘 되는지 확인
2. NestJS가 FastAPI를 잘 부르는지 확인
3. React가 NestJS 분석 API를 잘 부르는지 확인
```

왜 이 순서로 하냐면, 문제가 생겼을 때 원인을 찾기 쉽기 때문이다.

예를 들어 React 버튼부터 만들면 이런 일이 생긴다.

```text
버튼 눌렀는데 안 됨
```

그러면 원인을 알 수 없다.

```text
React 문제인가?
NestJS 문제인가?
FastAPI 문제인가?
DB 문제인가?
token 문제인가?
```

그래서 아래처럼 한 층씩 확인한다.

## 2.1 1층: FastAPI 단독 확인

먼저 AI 서버 혼자 되는지 본다.

연결되는 하위 단계:

```text
4번: FastAPI 요청/응답 스키마 만들기
5번: FastAPI 분석 서비스 만들기
6번: FastAPI 분석 라우터 만들기
7번: FastAPI main.py 수정
8번: FastAPI 실행과 테스트
```

성공 기준:

```text
curl http://localhost:8000/health
curl -X POST http://localhost:8000/analysis/demo ...
```

이 두 개가 된다.

## 2.2 2층: NestJS가 FastAPI 호출

그 다음 NestJS가 FastAPI에게 분석 요청을 보내게 만든다.

연결되는 하위 단계:

```text
9번: NestJS AI 타입 만들기
10번: NestJS AiService 만들기
11번: NestJS AiModule 만들기
12번: PostsModule에 AiModule 연결
13번: PostsService에 AI 분석 메서드 추가
14번: PostsController에 분석 API 추가
15번: 백엔드 환경변수 추가
16번: NestJS 분석 API 테스트
```

성공 기준:

```text
curl -X POST http://localhost:3000/posts/1/analyze \
  -H "Authorization: Bearer accessToken"
```

이 요청이 분석 결과를 돌려준다.

## 2.3 3층: React 화면 연결

마지막으로 브라우저 화면에 버튼을 붙인다.

연결되는 하위 단계:

```text
17번: 프론트 분석 타입 만들기
18번: 프론트 posts API에 analyzePost 추가
19번: 게시글 상세 화면에 AI 분석 버튼 추가
```

성공 기준:

```text
게시글 상세 화면
-> AI 분석 버튼 클릭
-> 분석 중 표시
-> 요약/추천/다음 목표 표시
```

마지막 확인은:

```text
20번: 오늘 테스트 흐름
21번: 자주 터지는 문제
22번: 오늘 마감 체크
23번: 오늘 완료 기준
```

여기서 한다.

---

# 3. 오늘 만들 파일을 미리 보는 이유

이제 파일 구조를 본다.

여기서 중요한 것은 파일명을 외우는 게 아니다.

중요한 건:

```text
어느 파일이 어느 층에 속하는지
```

를 아는 것이다.

## 3.1 1층 FastAPI 파일

```text
ai-server/app/
  schemas/analysis.py
  services/analysis_service.py
  routers/analysis.py
  main.py
```

이 파일들은 FastAPI AI 서버 쪽이다.

| 파일 | 쉬운 뜻 | 실제 구현 번호 |
| --- | --- | --- |
| `schemas/analysis.py` | FastAPI가 받을 데이터 모양 | 4번 |
| `services/analysis_service.py` | 임시 분석 결과 만드는 곳 | 5번 |
| `routers/analysis.py` | `/analysis/demo` 주소 여는 곳 | 6번 |
| `main.py` | router와 `/health` 등록하는 곳 | 7번 |

테스트는 8번에서 한다.

## 3.2 2층 NestJS 파일

```text
backend/src/
  ai/
    types.ts
    ai.service.ts
    ai.module.ts
  posts/
    posts.module.ts
    posts.service.ts
    posts.controller.ts
```

이 파일들은 NestJS 백엔드 쪽이다.

| 파일 | 쉬운 뜻 | 실제 구현 번호 |
| --- | --- | --- |
| `ai/types.ts` | FastAPI와 주고받을 데이터 타입 | 9번 |
| `ai/ai.service.ts` | FastAPI로 fetch 보내는 곳 | 10번 |
| `ai/ai.module.ts` | AiService를 NestJS에 등록 | 11번 |
| `posts.module.ts` | Posts 쪽에서 AiService 쓰게 연결 | 12번 |
| `posts.service.ts` | 현재 글/이전 기록 찾고 분석 요청 | 13번 |
| `posts.controller.ts` | `POST /posts/:id/analyze` 주소 열기 | 14번 |

환경변수는 15번, 테스트는 16번에서 한다.

## 3.3 3층 React 파일

```text
frontend/src/
  types/analysis.ts
  api/posts.ts
  pages/PostDetailPage.tsx
```

이 파일들은 React 화면 쪽이다.

| 파일 | 쉬운 뜻 | 실제 구현 번호 |
| --- | --- | --- |
| `types/analysis.ts` | 화면에서 받을 분석 결과 타입 | 17번 |
| `api/posts.ts` | React가 NestJS 분석 API 호출 | 18번 |
| `PostDetailPage.tsx` | 버튼과 결과 표시 UI | 19번 |

브라우저 확인은 20번부터 한다.

## 3.4 오늘 전체 지도

오늘 문서는 아래 순서로 읽으면 된다.

```text
0번 ~ 3번
-> 구현 전에 오늘 할 일을 이해하는 예열

4번 ~ 8번
-> FastAPI AI 서버 만들기

9번 ~ 16번
-> NestJS에서 AI 서버 호출하기

17번 ~ 19번
-> React 화면에 분석 버튼 붙이기

20번 ~ 23번
-> 실행, 테스트, 오류 확인, 완료 체크
```

그러니까 지금 0~3에서 모든 걸 이해하려고 하면 안 된다.

0~3은 그냥 이렇게 생각하면 된다.

```text
아, 오늘은 3층짜리 연결 작업이구나.
1층 FastAPI부터 만들고,
2층 NestJS가 그걸 부르게 하고,
3층 React에서 버튼으로 연결하는구나.
```

이 정도면 충분하다.

---

# 4. FastAPI 분석 요청/응답 스키마 만들기

파일:

```text
ai-server/app/schemas/analysis.py
```

코드:

```py
from typing import Optional  # 값이 없을 수도 있는 필드를 표시하기 위해 가져온다.
from pydantic import BaseModel  # FastAPI 요청/응답 데이터의 모양을 검사하는 부모 클래스다.


class SetRecord(BaseModel):  # 세트 하나의 기록 모양이다.
    setNumber: int  # 몇 번째 세트인지 받는다.
    reps: int  # 해당 세트에서 몇 회 했는지 받는다.
    perceivedDifficulty: Optional[int] = None  # 힘들었던 정도는 입력하지 않아도 된다.


class ExerciseRecord(BaseModel):  # 벤치프레스 같은 운동 하나의 기록 모양이다.
    exerciseName: str  # 운동 이름을 받는다.
    weightKg: float  # 사용한 무게를 kg 단위로 받는다.
    targetReps: Optional[int] = None  # 목표 반복 수는 입력하지 않아도 된다.
    sets: list[SetRecord]  # 이 운동에 포함된 세트 목록을 받는다.


class PostRecord(BaseModel):  # 게시글 하나를 FastAPI로 보낼 때의 기록 모양이다.
    id: int  # 게시글 id를 받는다.
    title: str  # 게시글 제목을 받는다.
    date: str  # 운동 날짜를 문자열로 받는다.
    bodyPart: str  # 운동 부위를 받는다.
    memo: Optional[str] = None  # 게시글 메모는 없어도 된다.
    exercises: list[ExerciseRecord]  # 게시글 안의 운동 목록을 받는다.


class AnalysisRequest(BaseModel):  # NestJS가 FastAPI에 보낼 분석 요청 모양이다.
    currentPost: PostRecord  # 지금 분석할 현재 게시글이다.
    previousPosts: list[PostRecord] = []  # 비교에 사용할 이전 게시글 목록이다.


class AnalysisResponse(BaseModel):  # FastAPI가 NestJS로 돌려줄 분석 결과 모양이다.
    summary: str  # 운동 기록 요약 문장이다.
    recommendation: str  # 다음 운동 방향 추천 문장이다.
    nextGoal: str  # 다음 운동에서 시도할 목표다.
    referencedPostCount: int  # 분석에 참고한 이전 기록 개수다.
```

해석:

```text
SetRecord
-> 1세트, 2세트 같은 세트 기록

ExerciseRecord
-> 벤치프레스 같은 운동 하나의 기록

PostRecord
-> 게시글 하나의 운동 기록

AnalysisRequest
-> NestJS가 FastAPI로 보낼 분석 요청 데이터

AnalysisResponse
-> FastAPI가 NestJS로 돌려줄 분석 결과
```

`BaseModel`은 FastAPI에서 요청/응답 데이터의 모양을 검사하는 기준이다.

`Optional[int]`, `Optional[str]`은 값이 있을 수도 있고 `None`일 수도 있다는 뜻이다.

현재 프로젝트의 Python 버전이 3.9 계열이므로 `int | None` 문법 대신 `Optional[int]`를 사용한다.

NestJS의 DTO와 비슷하게 보면 된다.

```text
NestJS DTO
-> TypeScript 백엔드에서 요청 body 검증

FastAPI Pydantic BaseModel
-> Python AI 서버에서 요청 body 검증
```

---

# 5. FastAPI 분석 서비스 만들기

파일:

```text
ai-server/app/services/analysis_service.py
```

코드:

```py
from app.schemas.analysis import AnalysisRequest, AnalysisResponse  # 분석 요청과 응답 데이터 모양을 가져온다.


def _format_main_exercise_name(request: AnalysisRequest) -> str:  # 현재 게시글에서 대표 운동 이름을 뽑는다.
    if not request.currentPost.exercises:
        return "운동"

    return request.currentPost.exercises[0].exerciseName


def _format_sets(request: AnalysisRequest) -> str:  # 첫 번째 운동의 세트 반복 수를 8/8/7 같은 문자열로 만든다.
    if not request.currentPost.exercises:
        return "기록 없음"

    first_exercise = request.currentPost.exercises[0]  # 분석 문장에 사용할 첫 번째 운동을 고른다.
    reps = [str(set_record.reps) for set_record in first_exercise.sets]  # 각 세트의 반복 수만 문자열로 뽑는다.

    return "/".join(reps)  # 8, 8, 7을 8/8/7 모양으로 합친다.


def make_demo_analysis(request: AnalysisRequest) -> AnalysisResponse:  # GPT 연결 전, 임시 AI 분석 결과를 만든다.
    exercise_name = _format_main_exercise_name(request)  # 분석 문장에 넣을 대표 운동 이름이다.
    current_sets = _format_sets(request)  # 분석 문장에 넣을 현재 세트 기록이다.
    previous_count = len(request.previousPosts)  # 비교에 사용된 이전 기록 개수다.

    summary = f"{request.currentPost.title} 기록입니다. {exercise_name} 세트 기록은 {current_sets}회입니다."  # 화면에 보여줄 짧은 요약이다.

    if previous_count == 0:
        recommendation = "아직 비교할 이전 기록이 부족합니다. 오늘 기록을 기준점으로 저장해두고 다음 운동 때 같은 조건으로 한 번 더 기록해보세요."  # 이전 기록이 없을 때의 추천이다.
        next_goal = f"다음 운동에서는 {exercise_name}의 목표 반복 수를 안정적으로 채우는 것을 우선하세요."  # 이전 기록이 없을 때의 다음 목표다.
    else:
        recommendation = "이전 기록이 있으므로 현재 기록과 비교할 수 있습니다. 오늘은 무게를 급하게 올리기보다 목표 반복 수를 먼저 채우는 방향이 좋습니다."  # 이전 기록이 있을 때의 추천이다.
        next_goal = f"다음 운동에서는 {exercise_name}를 같은 무게로 진행하면서 마지막 세트 반복 수를 1회 늘리는 것을 목표로 해보세요."  # 이전 기록이 있을 때의 다음 목표다.

    return AnalysisResponse(
        summary=summary,  # 요약 결과를 응답에 담는다.
        recommendation=recommendation,  # 추천 결과를 응답에 담는다.
        nextGoal=next_goal,  # 다음 목표를 응답에 담는다.
        referencedPostCount=previous_count,  # 참고한 이전 기록 개수를 응답에 담는다.
    )
```

해석:

```text
make_demo_analysis()
-> 오늘은 GPT를 부르기 전에 임시 분석 결과를 만든다.

previousPosts가 없으면
-> 이전 기록이 부족하다고 말한다.

previousPosts가 있으면
-> 이전 기록과 비교할 수 있다고 말한다.
```

오늘은 여기서 OpenAI API를 바로 붙이지 않아도 된다.

이유:

```text
먼저 React -> NestJS -> FastAPI 연결이 되는지 확인해야 한다.
연결이 안 된 상태에서 GPT까지 붙이면 어디서 터졌는지 찾기 어렵다.
```

---

# 6. FastAPI 분석 라우터 만들기

파일:

```text
ai-server/app/routers/analysis.py
```

코드:

```py
from fastapi import APIRouter  # FastAPI에서 API 주소 묶음을 만들기 위해 가져온다.
from app.schemas.analysis import AnalysisRequest, AnalysisResponse  # 분석 API의 요청/응답 모양을 가져온다.
from app.services.analysis_service import make_demo_analysis  # 실제 분석 결과를 만드는 함수를 가져온다.

router = APIRouter()  # 분석 관련 API 주소들을 이 router에 모은다.


@router.post("/demo", response_model=AnalysisResponse)  # POST /analysis/demo 요청을 받을 준비를 한다.
def analyze_demo(request: AnalysisRequest):  # NestJS가 보낸 운동 기록 분석 요청을 받는다.
    return make_demo_analysis(request)  # 임시 분석 결과를 만들어서 응답한다.
```

해석:

```text
POST /analysis/demo
-> 운동 기록 분석 요청을 받는다.
-> make_demo_analysis()를 실행한다.
-> AnalysisResponse 형식으로 응답한다.
```

여기서 `/analysis`는 나중에 `main.py`에서 prefix로 붙인다.

이 파일 안에서는 `/demo`만 적는다.

결과적으로 전체 주소는:

```text
POST /analysis/demo
```

---

# 7. FastAPI main.py 수정

파일:

```text
ai-server/app/main.py
```

코드:

```py
from fastapi import FastAPI  # FastAPI 서버 앱을 만들기 위해 가져온다.
from app.routers.demo import router as demo_router  # 기존 데모 API 묶음을 가져온다.
from app.routers.analysis import router as analysis_router  # 새로 만든 분석 API 묶음을 가져온다.

app = FastAPI()  # FastAPI 서버 객체를 만든다.

app.include_router(demo_router)  # 기존 데모 API를 서버에 등록한다.
app.include_router(analysis_router, prefix="/analysis", tags=["analysis"])  # 분석 API를 /analysis로 시작하는 주소에 등록한다.


@app.get("/health")  # GET /health 요청으로 AI 서버 상태를 확인할 수 있게 한다.
def health():  # AI 서버가 켜져 있는지 알려주는 함수다.
    return {
        "status": "ok",  # 서버가 정상이라는 표시다.
        "service": "ai-server",  # 이 응답이 AI 서버에서 온 것임을 표시한다.
    }
```

해석:

```text
demo_router
-> 기존 데모 API 유지

analysis_router
-> 새로 만든 분석 API 등록

prefix="/analysis"
-> analysis.py 안의 /demo가 실제로는 /analysis/demo가 된다.

/health
-> AI 서버가 켜져 있는지 확인하는 API
```

---

# 8. FastAPI 실행과 테스트

터미널:

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board/ai-server
# ai-server 전용 Python 가상환경을 켠다.
source .venv/bin/activate
# FastAPI AI 서버를 8000번 포트로 실행한다.
uvicorn app.main:app --reload --port 8000
```

다른 터미널에서 확인:

```bash
# FastAPI 서버가 켜져 있는지 확인한다.
curl http://localhost:8000/health
```

기대 응답:

```json
{
  "status": "ok",
  "service": "ai-server"
}
```

분석 API 테스트:

```bash
# FastAPI 분석 API가 요청 body를 받고 응답을 돌려주는지 확인한다.
curl -X POST http://localhost:8000/analysis/demo \
  -H "Content-Type: application/json" \
  -d '{
    "currentPost": {
      "id": 1,
      "title": "오늘 가슴 운동",
      "date": "2026-06-13",
      "bodyPart": "가슴",
      "memo": "마지막 세트가 힘들었다",
      "exercises": [
        {
          "exerciseName": "벤치프레스",
          "weightKg": 60,
          "targetReps": 8,
          "sets": [
            { "setNumber": 1, "reps": 8 },
            { "setNumber": 2, "reps": 8 },
            { "setNumber": 3, "reps": 7 }
          ]
        }
      ]
    },
    "previousPosts": []
  }'
```

기대 응답:

```json
{
  "summary": "오늘 가슴 운동 기록입니다. 벤치프레스 세트 기록은 8/8/7회입니다.",
  "recommendation": "아직 비교할 이전 기록이 부족합니다...",
  "nextGoal": "다음 운동에서는 벤치프레스의 목표 반복 수를 안정적으로 채우는 것을 우선하세요.",
  "referencedPostCount": 0
}
```

---

# 9. NestJS AI 타입 만들기

파일:

```text
backend/src/ai/types.ts
```

코드:

```ts
export type AiSetRecord = { // FastAPI로 보낼 세트 하나의 타입이다.
  setNumber: number; // 몇 번째 세트인지 담는다.
  reps: number; // 해당 세트에서 몇 회 했는지 담는다.
  perceivedDifficulty?: number | null; // 힘들었던 정도는 없을 수도 있다.
};

export type AiExerciseRecord = { // FastAPI로 보낼 운동 하나의 타입이다.
  exerciseName: string; // 운동 이름을 담는다.
  weightKg: number; // 사용한 무게를 담는다.
  targetReps?: number | null; // 목표 반복 수는 없을 수도 있다.
  sets: AiSetRecord[]; // 이 운동에 포함된 세트 목록을 담는다.
};

export type AiPostRecord = { // FastAPI로 보낼 게시글 하나의 타입이다.
  id: number; // 게시글 id를 담는다.
  title: string; // 게시글 제목을 담는다.
  date: string; // 운동 날짜를 문자열로 담는다.
  bodyPart: string; // 운동 부위를 담는다.
  memo?: string | null; // 메모는 없을 수도 있다.
  exercises: AiExerciseRecord[]; // 게시글 안의 운동 목록을 담는다.
};

export type AnalyzePostRequest = { // NestJS가 FastAPI로 보낼 분석 요청 타입이다.
  currentPost: AiPostRecord; // 지금 분석할 현재 게시글이다.
  previousPosts: AiPostRecord[]; // 비교에 사용할 이전 게시글 목록이다.
};

export type AnalyzePostResponse = { // FastAPI가 NestJS로 돌려줄 분석 결과 타입이다.
  summary: string; // 운동 기록 요약이다.
  recommendation: string; // 다음 운동 방향 추천이다.
  nextGoal: string; // 다음 운동 목표다.
  referencedPostCount: number; // 참고한 이전 기록 개수다.
};
```

해석:

```text
FastAPI로 보낼 데이터 형식을 TypeScript에서도 정의한다.
```

FastAPI의 `AnalysisRequest`, `AnalysisResponse`와 같은 모양이어야 한다.

---

# 10. NestJS AiService 만들기

파일:

```text
backend/src/ai/ai.service.ts
```

코드:

```ts
import { Injectable } from '@nestjs/common'; // NestJS가 AiService 객체를 관리할 수 있게 하는 표시를 가져온다.
import { ConfigService } from '@nestjs/config'; // .env 값을 읽기 위해 가져온다.
import type { AnalyzePostRequest, AnalyzePostResponse } from './types'; // FastAPI와 주고받을 데이터 타입을 가져온다.

@Injectable() // AiService를 다른 클래스에 주입해서 쓸 수 있게 NestJS 관리 대상으로 등록한다.
export class AiService {
  constructor(private readonly configService: ConfigService) {} // .env 값을 읽는 도구를 NestJS에게 받아온다.

  async analyzePost(payload: AnalyzePostRequest): Promise<AnalyzePostResponse> { // FastAPI에 분석 요청을 보내고 결과를 받아오는 함수다.
    const aiServerUrl =
      this.configService.get<string>('AI_SERVER_URL') ?? 'http://localhost:8000'; // .env에 주소가 없으면 로컬 AI 서버 주소를 사용한다.

    // NestJS 서버가 FastAPI 서버의 /analysis/demo 주소로 HTTP 요청을 보낸다.
    const response = await fetch(`${aiServerUrl}/analysis/demo`, {
      method: 'POST', // 분석 데이터를 보내야 하므로 POST 요청을 사용한다.
      headers: {
        'Content-Type': 'application/json', // 요청 body가 JSON이라는 뜻이다.
      },
      body: JSON.stringify(payload), // TypeScript 객체를 HTTP로 보낼 수 있는 JSON 문자열로 바꾼다.
    });

    if (!response.ok) {
      const message = await response.text(); // FastAPI가 보낸 에러 내용을 문자열로 읽는다.
      throw new Error(message || 'AI 서버 요청에 실패했습니다.'); // FastAPI 호출 실패를 NestJS 에러로 바꾼다.
    }

    return response.json() as Promise<AnalyzePostResponse>; // FastAPI 응답 JSON을 분석 결과 타입으로 돌려준다.
  }
}
```

해석:

```text
AiService
-> NestJS 안에서 FastAPI를 호출하는 작업자

AI_SERVER_URL
-> FastAPI 서버 주소

fetch()
-> NestJS 서버가 FastAPI 서버로 HTTP 요청을 보냄
```

금요일에는 React가 NestJS에 `fetch`를 보냈다.

토요일에는 NestJS가 FastAPI에 `fetch`를 보낸다.

```text
금요일:
React -> fetch -> NestJS

토요일:
NestJS -> fetch -> FastAPI
```

---

# 11. NestJS AiModule 만들기

파일:

```text
backend/src/ai/ai.module.ts
```

코드:

```ts
import { Module } from '@nestjs/common'; // NestJS 모듈 설정표를 만들기 위해 가져온다.
import { AiService } from './ai.service'; // FastAPI 호출 작업자를 가져온다.

@Module({
  providers: [AiService], // NestJS가 AiService 객체를 만들 수 있게 등록한다.
  exports: [AiService], // 다른 모듈에서도 AiService를 주입받을 수 있게 공개한다.
})
export class AiModule {} // AI 기능을 하나로 묶는 NestJS 모듈이다.
```

해석:

```text
providers: [AiService]
-> NestJS가 AiService 객체를 만들 수 있게 등록한다.

exports: [AiService]
-> 다른 모듈에서도 AiService를 가져다 쓸 수 있게 공개한다.
```

이걸 해야 `PostsService`에서 `AiService`를 주입받을 수 있다.

---

# 12. PostsModule에 AiModule 연결

파일:

```text
backend/src/posts/posts.module.ts
```

코드:

```ts
import { Module } from '@nestjs/common'; // NestJS 모듈 설정표를 만들기 위해 가져온다.
import { AuthModule } from '../auth/auth.module'; // 게시글 API에서 JWT 인증을 쓰기 위해 가져온다.
import { AiModule } from '../ai/ai.module'; // 게시글 기능에서 AiService를 쓰기 위해 가져온다.
import { PostsController } from './posts.controller'; // /posts 요청을 받는 담당자를 가져온다.
import { PostsService } from './posts.service'; // 게시글 실제 작업을 처리하는 담당자를 가져온다.

@Module({
  imports: [AuthModule, AiModule], // PostsModule 안에서 인증 기능과 AI 기능을 사용할 수 있게 연결한다.
  controllers: [PostsController], // /posts API 요청을 받을 컨트롤러를 등록한다.
  providers: [PostsService], // PostsController가 사용할 작업 객체를 등록한다.
})
export class PostsModule {} // 게시글 기능을 하나로 묶는 NestJS 모듈이다.
```

해석:

```text
PostsModule이 AiModule을 import한다.
        ↓
PostsService가 AiService를 constructor로 받을 수 있다.
```

---

# 13. PostsService에 AI 분석 메서드 추가

파일:

```text
backend/src/posts/posts.service.ts
```

추가 import:

```ts
import { AiService } from '../ai/ai.service'; // PostsService에서 FastAPI 호출 기능을 쓰기 위해 가져온다.
import type { AiPostRecord } from '../ai/types'; // Prisma 게시글을 FastAPI 전송용 모양으로 바꿀 때 쓸 타입이다.
```

constructor 수정:

```ts
constructor(
  private readonly prisma: PrismaService, // DB 조회와 저장을 하기 위해 PrismaService를 받아온다.
  private readonly aiService: AiService, // FastAPI 분석 요청을 보내기 위해 AiService를 받아온다.
) {}
```

파일 위쪽에 변환 함수 추가:

```ts
function toAiPostRecord(post: any): AiPostRecord { // Prisma 게시글 객체를 FastAPI가 이해할 JSON 모양으로 바꾼다.
  return {
    id: post.id, // 게시글 id를 FastAPI 요청에 담는다.
    title: post.title, // 게시글 제목을 FastAPI 요청에 담는다.
    date: post.date.toISOString().slice(0, 10), // Date 객체를 2026-06-13 같은 문자열로 바꾼다.
    bodyPart: post.bodyPart, // 운동 부위를 FastAPI 요청에 담는다.
    memo: post.memo, // 게시글 메모를 FastAPI 요청에 담는다.
    exercises: post.exercises.map((exercise) => ({ // 운동 목록을 FastAPI가 받을 모양으로 하나씩 바꾼다.
      exerciseName: exercise.exerciseName, // 운동 이름을 담는다.
      weightKg: exercise.weightKg, // 운동 무게를 담는다.
      targetReps: exercise.targetReps, // 목표 반복 수를 담는다.
      sets: exercise.sets.map((set) => ({ // 세트 목록을 FastAPI가 받을 모양으로 하나씩 바꾼다.
        setNumber: set.setNumber, // 세트 번호를 담는다.
        reps: set.reps, // 실제 반복 수를 담는다.
        perceivedDifficulty: set.perceivedDifficulty, // 힘들었던 정도를 담는다.
      })),
    })),
  };
}
```

해석:

```text
Prisma에서 가져온 post 객체
-> FastAPI가 받기 쉬운 JSON 모양으로 변환
```

`PostsService` 클래스 안에 추가:

```ts
async analyze(userId: number, id: number) { // 로그인한 사용자의 특정 게시글을 AI 분석하는 함수다.
  // 먼저 분석할 현재 게시글을 DB에서 찾는다.
  const currentPost = await this.prisma.post.findUnique({
    where: { id }, // URL로 받은 게시글 id와 일치하는 글을 찾는다.
    include: postInclude, // 운동 목록과 세트 목록까지 함께 가져온다.
  });

  if (!currentPost) {
    throw new NotFoundException('게시글을 찾을 수 없습니다.'); // 없는 게시글이면 404 에러를 보낸다.
  }

  if (currentPost.authorId !== userId) {
    throw new ForbiddenException('게시글을 분석할 권한이 없습니다.'); // 글 작성자가 아니면 분석을 막는다.
  }

  const normalizedNames = currentPost.exercises
    .map((exercise) => exercise.normalizedName) // 현재 글에 들어간 운동명을 검색용 이름으로 뽑는다.
    .filter((name): name is string => Boolean(name)); // 비어 있는 운동명은 이전 기록 검색에서 제외한다.

  // 현재 글과 같은 운동명이 들어간 이전 게시글을 최대 3개 찾는다.
  const previousPosts = await this.prisma.post.findMany({
    where: {
      authorId: userId, // 로그인한 사용자가 쓴 글만 비교 대상으로 삼는다.
      id: {
        not: id, // 현재 분석 중인 글은 이전 기록에서 제외한다.
      },
      exercises: {
        some: {
          normalizedName: {
            in: normalizedNames, // 현재 글의 운동명과 겹치는 이전 기록을 찾는다.
          },
        },
      },
    },
    orderBy: {
      date: 'desc', // 가장 최근 운동 기록부터 가져온다.
    },
    take: 3, // 비교용 이전 기록은 최대 3개만 사용한다.
    include: postInclude, // 이전 기록도 운동 목록과 세트 목록까지 함께 가져온다.
  });

  return this.aiService.analyzePost({
    currentPost: toAiPostRecord(currentPost), // 현재 게시글을 FastAPI 요청용 모양으로 바꿔 보낸다.
    previousPosts: previousPosts.map(toAiPostRecord), // 이전 게시글 목록도 FastAPI 요청용 모양으로 바꿔 보낸다.
  });
}
```

해석:

```text
1. 현재 게시글을 찾는다.
2. 게시글이 없으면 404를 던진다.
3. 작성자가 아니면 403을 던진다.
4. 현재 게시글의 운동명을 뽑는다.
5. 같은 운동명이 들어간 이전 게시글을 찾는다.
6. 현재 기록과 이전 기록을 FastAPI로 보낸다.
7. FastAPI 분석 결과를 그대로 반환한다.
```

여기서 `take: 3`은 이전 기록을 최대 3개만 가져오겠다는 뜻이다.

---

# 14. PostsController에 분석 API 추가

파일:

```text
backend/src/posts/posts.controller.ts
```

Controller 안에 추가:

```ts
@UseGuards(JwtAuthGuard) // 이 API는 로그인한 사용자만 호출할 수 있게 막는다.
@Post(':id/analyze') // POST /posts/:id/analyze 요청을 이 함수로 연결한다.
analyze(
  @Req() request: AuthenticatedRequest, // JwtAuthGuard가 넣어둔 로그인 사용자 정보를 받는다.
  @Param('id', ParseIntPipe) id: number, // URL의 id 값을 숫자로 바꿔서 받는다.
) {
  return this.postsService.analyze(request.user.id, id); // 로그인 사용자 id와 게시글 id를 서비스로 넘긴다.
}
```

해석:

```text
POST /posts/:id/analyze
-> 특정 게시글을 AI 분석한다.

@UseGuards(JwtAuthGuard)
-> 로그인한 사용자만 요청할 수 있다.

request.user.id
-> JwtAuthGuard가 붙여둔 로그인 사용자 id다.

id
-> URL에서 가져온 게시글 id다.
```

---

# 15. 백엔드 환경변수 추가

파일:

```text
backend/.env
```

내용:

```env
# NestJS가 호출할 FastAPI AI 서버 주소다.
AI_SERVER_URL=http://localhost:8000
```

해석:

```text
NestJS가 FastAPI 서버를 어디로 호출해야 하는지 알려주는 값이다.
```

코드에는 기본값도 넣어뒀기 때문에 이 값이 없어도 `http://localhost:8000`을 사용한다.

그래도 명시적으로 적어두는 편이 좋다.

---

# 16. NestJS 분석 API 테스트

먼저 세 개를 켠다.

터미널 1:

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board
# PostgreSQL DB를 백그라운드로 실행한다.
docker compose up -d
```

터미널 2:

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board/ai-server
# ai-server 전용 Python 가상환경을 켠다.
source .venv/bin/activate
# FastAPI AI 서버를 8000번 포트로 실행한다.
uvicorn app.main:app --reload --port 8000
```

터미널 3:

```bash
cd /Users/igyeong-geun/Documents/jungle/week15/ai-workout-board/backend
# NestJS 백엔드 서버를 개발 모드로 실행한다.
npm run start:dev
```

로그인해서 token을 얻는다.

```bash
# 백엔드 로그인 API에 요청을 보낸다.
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"12345678"}'
```

게시글 분석 요청:

```bash
# 1번 게시글을 AI 분석해달라고 요청한다.
# 로그인한 사용자임을 증명하기 위해 accessToken을 보낸다.
curl -X POST http://localhost:3000/posts/1/analyze \
  -H "Authorization: Bearer 여기에_accessToken"
```

기대 응답:

```json
{
  "summary": "오늘 가슴 운동 기록입니다...",
  "recommendation": "이전 기록이 있으므로...",
  "nextGoal": "다음 운동에서는...",
  "referencedPostCount": 1
}
```

---

# 17. 프론트 분석 타입 만들기

파일:

```text
frontend/src/types/analysis.ts
```

코드:

```ts
export type AnalysisResult = { // 화면에서 사용할 AI 분석 결과 타입이다.
  summary: string; // 운동 기록 요약이다.
  recommendation: string; // 다음 운동 방향 추천이다.
  nextGoal: string; // 다음 운동 목표다.
  referencedPostCount: number; // 분석에 참고한 이전 기록 개수다.
};
```

해석:

```text
백엔드가 돌려주는 AI 분석 결과의 타입이다.
```

---

# 18. 프론트 posts API에 analyzePost 추가

파일:

```text
frontend/src/api/posts.ts
```

추가 import:

```ts
import type { AnalysisResult } from '../types/analysis'; // AI 분석 결과 타입을 가져온다.
```

함수 추가:

```ts
export function analyzePost(id: number) { // 특정 게시글의 AI 분석을 백엔드에 요청하는 함수다.
  return apiRequest<AnalysisResult>(`/posts/${id}/analyze`, {
    method: 'POST', // 분석을 실행시키는 요청이므로 POST를 사용한다.
    token: getStoredToken(), // 로그인한 사용자만 분석할 수 있어서 저장된 accessToken을 보낸다.
  });
}
```

해석:

```text
analyzePost(1)
-> POST /posts/1/analyze 요청

token
-> 로그인한 사용자만 분석할 수 있으므로 accessToken을 보낸다.
```

---

# 19. 게시글 상세 화면에 AI 분석 버튼 추가

파일:

```text
frontend/src/pages/PostDetailPage.tsx
```

추가 import:

```ts
import { analyzePost, getPost } from '../api/posts'; // 게시글 조회와 AI 분석 요청 함수를 가져온다.
import type { AnalysisResult } from '../types/analysis'; // AI 분석 결과 타입을 가져온다.
```

state 추가:

```ts
const [analysis, setAnalysis] = useState<AnalysisResult | null>(null); // AI 분석 결과를 화면에 보관한다.
const [isAnalyzing, setIsAnalyzing] = useState(false); // 지금 분석 중인지 버튼 상태에 사용한다.
const [analysisError, setAnalysisError] = useState(''); // AI 분석 실패 메시지를 화면에 보관한다.
```

함수 추가:

```ts
async function handleAnalyze() { // 사용자가 AI 분석 버튼을 눌렀을 때 실행되는 함수다.
  setIsAnalyzing(true); // 버튼을 누른 직후 분석 중 상태로 바꾼다.
  setAnalysisError(''); // 이전에 남아 있던 에러 메시지를 지운다.

  try {
    const result = await analyzePost(postId); // 백엔드의 POST /posts/:id/analyze API를 호출한다.
    setAnalysis(result); // 백엔드가 돌려준 분석 결과를 화면 상태에 저장한다.
  } catch (error) {
    setAnalysisError(error instanceof Error ? error.message : 'AI 분석에 실패했습니다.'); // 실패하면 사용자에게 보여줄 메시지를 저장한다.
  } finally {
    setIsAnalyzing(false); // 성공하든 실패하든 분석 중 상태를 끝낸다.
  }
}
```

화면 코드에서 운동 기록 섹션 아래에 추가:

```tsx
<section>
  <h2>AI 분석</h2> {/* AI 분석 결과 영역의 제목이다. */}
  <button type="button" onClick={handleAnalyze} disabled={isAnalyzing}> {/* 버튼을 누르면 AI 분석 요청을 시작한다. */}
    {isAnalyzing ? '분석 중...' : 'AI 분석'} {/* 분석 중이면 버튼 문구를 바꿔서 중복 클릭을 줄인다. */}
  </button>

  {analysisError && <p>{analysisError}</p>} {/* 분석 실패 메시지가 있을 때만 화면에 보여준다. */}

  {analysis && (
    <article> {/* 분석 결과가 있을 때만 결과 박스를 보여준다. */}
      <h3>요약</h3> {/* AI가 만든 운동 기록 요약 제목이다. */}
      <p>{analysis.summary}</p> {/* AI가 만든 운동 기록 요약 내용이다. */}

      <h3>추천</h3> {/* AI가 만든 다음 운동 방향 제목이다. */}
      <p>{analysis.recommendation}</p> {/* AI가 만든 다음 운동 방향 내용이다. */}

      <h3>다음 목표</h3> {/* 다음 운동 목표 제목이다. */}
      <p>{analysis.nextGoal}</p> {/* AI가 제안한 다음 운동 목표 내용이다. */}

      <p>참고한 이전 기록 수: {analysis.referencedPostCount}</p> {/* AI 분석에 사용된 이전 게시글 개수를 보여준다. */}
    </article>
  )}
</section>
```

해석:

```text
AI 분석 버튼 클릭
-> handleAnalyze 실행
-> analyzePost(postId) 호출
-> 백엔드로 POST /posts/:id/analyze 요청
-> 결과를 analysis state에 저장
-> 화면에 요약/추천/다음 목표 표시
```

---

# 20. 오늘 테스트 흐름

## 20.1 FastAPI 단독 테스트

```bash
# FastAPI 서버가 켜져 있는지 확인한다.
curl http://localhost:8000/health
```

```bash
# FastAPI 분석 API가 단독으로 동작하는지 확인한다.
curl -X POST http://localhost:8000/analysis/demo \
  -H "Content-Type: application/json" \
  -d '{...}'
```

## 20.2 NestJS 분석 API 테스트

```bash
# NestJS가 로그인 토큰을 가지고 FastAPI 분석까지 연결하는지 확인한다.
curl -X POST http://localhost:3000/posts/1/analyze \
  -H "Authorization: Bearer 여기에_accessToken"
```

## 20.3 브라우저에서 확인

```text
1. 프론트 실행
2. 로그인
3. 게시글 상세 화면 이동
4. AI 분석 버튼 클릭
5. 분석 중 표시 확인
6. 요약/추천/다음 목표 표시 확인
```

---

# 21. 자주 터지는 문제

## 21.1 FastAPI 서버가 안 켜져 있음

증상:

```text
AI 서버 요청 실패
fetch failed
ECONNREFUSED
```

확인:

```bash
# AI 서버가 살아 있는지 먼저 확인한다.
curl http://localhost:8000/health
```

## 21.2 NestJS에서 FastAPI 주소가 틀림

확인:

```text
AI_SERVER_URL=http://localhost:8000
```

## 21.3 token 없이 분석 요청

증상:

```text
401 Unauthorized
```

이유:

```text
POST /posts/:id/analyze는 JwtAuthGuard가 붙어 있으므로 로그인 token이 필요하다.
```

## 21.4 남의 게시글 분석

증상:

```text
403 Forbidden
```

이유:

```text
운동 기록 분석은 개인 기록 기반이라 작성자만 분석할 수 있게 막는다.
```

## 21.5 이전 기록이 0개

이건 오류가 아니다.

처음 작성한 운동 기록이면 비교할 과거 기록이 없을 수 있다.

응답에서:

```json
{
  "referencedPostCount": 0
}
```

이면 정상이다.

---

# 22. 오늘 마감 체크

```text
FastAPI /health 동작
FastAPI /analysis/demo 동작
NestJS POST /posts/:id/analyze 동작
현재 게시글 조회 가능
이전 기록 조회 가능
FastAPI로 현재 기록/이전 기록 전달 가능
React 상세 화면에 AI 분석 버튼 표시
분석 중 로딩 표시
분석 결과 화면 표시
frontend npm run build 성공
backend npm run build 성공
```

---

# 23. 오늘 완료 기준

오늘은 아래가 되면 성공이다.

```text
게시글 상세 화면에서 AI 분석 버튼을 누르면
요약, 추천, 다음 목표가 화면에 표시된다.
```

오늘 중요한 것은 AI 답변의 완성도가 아니다.

핵심은:

```text
React
-> NestJS
-> FastAPI
-> NestJS
-> React
```

이 연결이 실제로 동작하는 것이다.
