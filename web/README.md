# StudyTube Web

React와 Vite로 만든 학습 화면입니다. 영상을 보며 번역 자막을 확인하고 메모와 퀴즈로 복습합니다. 코스 생성과 다음 영상 추천도 같은 화면에서 요청합니다.

[프로젝트 소개](../README.md) | [아키텍처](../docs/architecture.md) | [개발 환경](../docs/environment-setup.md)

## 화면 구성

| 기능 | 코드 |
| --- | --- |
| 화면 이동과 로그인 확인 | `src/App.tsx`, `src/authSession.ts` |
| 학습 화면 구성 | `src/features/learning/LearningWorkspace.tsx` |
| YouTube 재생과 시점 이동 | `src/features/learning/LearningVideoPlayer.tsx` |
| 원문과 번역 준비 상태 | `src/features/learning/captionState.ts` |
| 퀴즈 요청과 제출 | `src/features/learning/useAdaptiveQuiz.ts` |
| 다음 영상 추천 | `src/features/learning/useNextLearningProposal.ts` |
| API 호출과 응답 타입 | `src/api.ts`, `src/courseApi.ts` |

## 상태 관리

선택한 탭과 패널, 상태 조회 주기는 브라우저에서 관리합니다. 메모와 진도, 퀴즈 답안, 추천안과 코스의 저장 결과는 API 응답을 기준으로 갱신합니다. 브라우저 저장소에는 학습 데이터의 원본을 두지 않습니다.

`fetch`는 HttpOnly 세션 쿠키를 사용합니다. Bearer 토큰을 저장하지 않으며 세션 또는 Origin 검사에 실패하면 인증 화면으로 돌아갑니다.

## 로컬 실행

`web` 디렉터리에서 실행합니다.

```powershell
npm ci
npm run dev -- --host 127.0.0.1
```

기본 주소는 `http://127.0.0.1:5173`입니다. API 주소와 허용 Origin은 [환경 변수 예시](../.env.example)와 API 설정에 맞춥니다. 자막과 퀴즈를 사용하려면 API뿐 아니라 Worker와 AI 서버도 실행해야 합니다.

## 검증

```powershell
npm run lint
node --test tests/*.test.ts
npm run build
```

Node 테스트는 브라우저 없이 상태 변화와 API 요청 형식을 검사합니다. 로그인부터 실제 학습 화면까지 확인하려면 API와 PostgreSQL, Valkey, 테스트 계정이 필요합니다. 기존 화면 확인 결과는 [검증 기록](../docs/verification.md)에 있습니다.
