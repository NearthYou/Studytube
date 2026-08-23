# StudyTube Web

React와 Vite로 만든 StudyTube browser client다. 로그인한 사용자가 영상과 progressive caption을 보고, 시점 메모, adaptive quiz와 다음 학습 proposal을 한 workspace에서 다룬다.

## 화면 책임

| 영역 | source |
| --- | --- |
| route와 session gate | `src/App.tsx`, `src/authSession.ts` |
| 학습 화면 조합 | `src/features/learning/LearningWorkspace.tsx` |
| YouTube player와 seek | `src/features/learning/LearningVideoPlayer.tsx` |
| 자막 상태 | `src/features/learning/captionState.ts` |
| quiz lifecycle | `src/features/learning/useAdaptiveQuiz.ts` |
| 다음 학습 proposal | `src/features/learning/useNextLearningProposal.ts` |
| API contract | `src/api.ts`, `src/courseApi.ts` |

## 상태 경계

UI는 현재 tab, 선택한 panel과 polling state를 관리한다. note, progress, quiz attempt, proposal과 Course mutation은 API 응답을 authoritative state로 사용한다.

Browser는 bearer token을 저장하지 않는다. `fetch`는 HttpOnly session cookie를 사용하며 session 또는 Origin 검증에 실패하면 인증 화면으로 돌아간다.

## 실행

```powershell
npm ci
npm run dev -- --host 127.0.0.1
```

기본 주소는 `http://127.0.0.1:5173`이다. API URL과 allowed origin은 root `.env.example`과 API 환경 설정을 따른다.

## 검증

```powershell
npm run lint
node --test tests/*.test.ts
npm run build
```

Node test는 browser 없이 state transition과 API request shape를 확인한다. 인증 이후 실제 학습 화면은 API, PostgreSQL, Valkey와 test account를 포함한 별도 browser E2E가 필요하다.

## 현재 한계

- progressive caption과 quiz는 backend work 상태에 의존한다.
- sessionStorage는 authoritative 학습 기록이 아니다.
- current main의 full authenticated E2E 화면은 repository에 새로 캡처하지 않았다.
