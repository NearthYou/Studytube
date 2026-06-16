# 프론트엔드 유지보수성 개선 프롬프트

작성일: 2026-06-12  
목적: PDF나 이전 대화 맥락 없이도, 프론트엔드 프로젝트의 수정 용이성/예측 가능성/UX 안정성을 실제 코드 수정과 검증까지 끌고 가기 위한 재사용 프롬프트를 보관한다.

## 검증 요약

이 프롬프트는 검증용 프로젝트 복사본에서 실제로 테스트했다.

- 1차 프롬프트는 구조 개선은 유도했지만, 회원가입 데스크톱 좌우 정렬 `114px` 오차를 놓쳤다.
- 최종 프롬프트는 브라우저 수치 기반 acceptance check를 강제했고, 같은 fixture에서 다음 결과를 확인했다.
  - `npm run build` 통과
  - `npm run lint` 통과
  - `npm test -- --run` 통과
  - `/login` desktop top/bottom delta `0px`
  - `/signup` desktop top/bottom delta `0px`
  - mobile `/login`, `/signup` horizontal overflow 없음

핵심 교훈은 “브라우저 확인”이라고만 쓰면 부족하고, 반드시 수치 기준과 실패 시 재검증 조건을 프롬프트에 넣어야 한다는 점이다.

## 최종 프롬프트

```md
너는 30년차 프론트엔드 개발자 역할로 작업해줘.

작업 대상은 현재 프론트엔드 프로젝트다.
PDF나 이전 대화 맥락은 없다고 가정해.

목표:
현재 프론트엔드 프로젝트를 “수정하기 쉽고, 예측 가능하고, 사용자 경험이 깨지지 않는 구조”로 끝까지 개선해줘.

핵심 기준:
- 수정 용이성이 최우선이다.
- 가독성, 예측 가능성, 응집도, 결합도를 개선한다.
- 화면, API, 상태, 스타일, 라우팅이 불필요하게 섞여 있으면 역할별로 분리한다.
- 단순히 줄 수를 줄이기 위한 과한 추상화는 하지 않는다.
- 사람의 기억에 의존하지 않도록 타입, 유틸, 테스트, 명확한 구조로 실수를 줄인다.
- CSS가 한 파일에 몰려 있으면 styles 구조 안에서 역할별로 분리한다.
- UX는 말로 확인하지 말고 브라우저 수치로 검증한다.
- 기존 프로젝트의 네이밍, 폴더 구조, 디자인 톤을 우선한다.
- 사용자 변경사항을 되돌리지 않는다.

반드시 수행할 작업:
1. 프로젝트 구조를 먼저 탐색한다.
   - 주요 페이지
   - components
   - hooks
   - api
   - utils
   - styles
   - routes
   - assets
2. 큰 파일 top 20을 줄 수 기준으로 뽑는다.
3. 다음 위험 패턴을 검색한다.
   - TODO, FIXME
   - console.log, debugger
   - as any
   - dangerouslySetInnerHTML, innerHTML
   - 중복된 API/상태 변환 로직
   - 컴포넌트 안에 과도하게 섞인 비즈니스 로직
   - CSS 한 파일에 여러 책임이 섞인 경우
   - 접근성 누락 가능성이 있는 button/img/form 요소
4. 우선순위를 정해 실제 코드를 수정한다.
5. 한 번 수정하고 끝내지 말고 다음 루프를 반복한다.
   - 큰 파일/위험 패턴 재검색
   - 가장 효과 큰 후보 선택
   - 코드 수정
   - build/lint/test 실행
   - 관련 화면 브라우저 검증
   - 새로 발견된 문제 수정
6. 최소한 다음 유형의 개선 후보를 확인한다.
   - 레이아웃/Header/Sidebar 같은 공통 UI
   - 로그인/회원가입 같은 auth UI
   - 게시글 목록/상세/작성/수정/삭제 흐름
   - 댓글/좋아요 같은 상호작용 UI
   - API 응답 mapper
   - form payload 생성 로직
   - 날짜/텍스트/인증 guard 같은 util 후보
   - 반응형 CSS

필수 브라우저 acceptance check:
- desktop과 mobile에서 가로 overflow가 없어야 한다.
- header/sidebar/main이 서로 겹치면 안 된다.
- login/signup 같은 auth 2-column 화면이 있다면 desktop에서 좌측 컬럼과 우측 컬럼의 top/bottom 차이가 1px 이하여야 한다.
  - 예: `.login-copy`와 `.login-form`, `.auth-divider`, `.social-login-list`, `.signup-row`로 구성된 우측 컬럼의 top/bottom을 `getBoundingClientRect()`로 비교한다.
  - 이 검사가 실패하면 “브라우저 확인 완료”라고 말하지 말고 CSS를 고친 뒤 같은 검증을 재실행한다.
- assistant/popover/modal이 있다면 열기, Escape 닫기, 닫힌 뒤 trigger focus 복원을 확인한다.
- form submit payload가 있다면 테스트나 mock request로 구조를 확인한다.
- API가 필요한 화면은 mock 응답으로라도 렌더링을 확인한다.

검증 명령:
- `npm run build`
- `npm run lint`
- 테스트 스크립트가 있다면 `npm test` 또는 프로젝트에 맞는 테스트 명령

완료 기준:
- build/lint/test가 통과한다.
- 위험 패턴 검색에서 새 문제가 없다.
- 필수 브라우저 acceptance check가 통과한다.
- 남은 큰 파일은 왜 유지하는지 근거가 있다.
- 다음 개발자가 기능을 수정할 때 이전보다 파일 위치와 책임을 더 쉽게 예측할 수 있다.

중요:
- 계획만 말하고 멈추지 말고 직접 구현해.
- 한두 개 수정하고 끝내지 말고, 의미 있는 개선 후보가 더 이상 없다고 판단될 때까지 반복해.
- 검증 실패가 나오면 반드시 코드를 수정하고 같은 검증을 재실행해.
- 새 라이브러리는 꼭 필요할 때만 추가해.

최종 Evidence Report에는 다음을 포함해:
1. 최초 탐색 결과
   - 가장 큰 파일 top 20
   - 위험 패턴 검색 결과
   - 주요 구조 요약
2. 실제 수정 내역
   - 어떤 파일을 왜 수정했는지
   - 수정 전 문제가 무엇이었는지
   - 수정 후 책임이 어떻게 분리됐는지
3. 반복 개선 기록
   - 1차/2차/3차로 무엇을 개선했는지
   - 더 이상 손대지 않은 큰 파일은 왜 유지했는지
4. 검증 결과
   - build/lint/test 결과
   - 브라우저 desktop/mobile 확인 결과
   - auth top/bottom delta 같은 실제 수치
   - 발견한 버그와 수정 내용
5. 최종 완료 판단
   - 위험 패턴 재검색 결과
   - 남은 리스크
   - 목표 달성 여부
```
