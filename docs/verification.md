# StudyTube 검증 기록

## 테스트 유지 기준

테스트는 사용자 동작과 API 응답, 저장 결과 또는 실제 오류 조건을 확인합니다. 파일 위치와 함수 이름, 소스 줄 수만 확인하는 검사는 빌드 및 동작 검증과 겹치므로 제거했습니다.

Health 응답은 [HTTP 통합 검사](../api/test/app.e2e-spec.ts)에서 확인합니다. DB 장애 시 준비 상태와 외부 의존성 없는 생존 확인은 [서비스 검사](../api/src/app.service.spec.ts)를 유지합니다. 로그인과 권한, 계정 삭제, 자막과 퀴즈, 작업 중복 및 재시도, 마이그레이션과 배포 검사는 유지합니다.

자막 결과를 고장 낸 비교에서는 함수 위치 검사만 통과했고 기존 자막 동작 검사는 실패했습니다. 비교 뒤 실제 코드는 원래대로 복원했습니다. 소스 형식 검사 대신 결과를 확인하는 테스트를 남기는 기준으로 삼았습니다.

아래 CI와 기존 서비스 화면은 2026년 9월 4일 기록입니다. 퀴즈와 검색 평가는 10월 18일 실행 결과입니다. 10월 21일 운영 화면은 별도 항목에 정리했습니다.

## 2026년 10월 21일 운영 화면

Google 로그인 후 `https://studytube.page/courses`와 `/courses/new`를 열어 화면을 확인했습니다. 이미 저장된 코스를 조회했으며 새 코스 생성은 실행하지 않았습니다.

- [운영 코스 보관함](demo/studytube-course-library-live-20261021.png): 저장된 코스와 영상 순서, 검색과 필터.
- [운영 코스 만들기](demo/studytube-course-builder-live-20261021.png): 학습 목표 입력과 추천 기준 안내.

## 퀴즈와 검색 평가 기록

[평가 자료 안내](../.eval/README.md)에 입력 기준, 공개 결과와 재현 명령을 정리했습니다.

- [퀴즈 집계](../.eval/quiz-eval-summary.json): 영상 27개, 최초 135문제, 모델이 근거 부족으로 판정한 7문제, 최종 검증 통과 24개 영상.
- [영상별 퀴즈와 판정](../.eval/quiz-results.public.json): 자막 전체와 인용문은 제외하고 영상 URL과 구간, 생성 문제와 모델 판정을 공개합니다.
- [검색 결과](../.eval/retrieval-evaluation.json): 질문 10개의 키워드, 벡터, 결합 검색 순위와 지표를 보관합니다. Recall@3은 각각 0.70, 0.90, 0.90입니다.
- [검색 정답 기준](../api/evaluation/retrieval-judgments.ko.json): 질문별 정답 게시글을 명시합니다. 이 평가의 시점 인용 충족률은 0이며 영상 시점의 정확도를 입증하지 않습니다.

퀴즈의 `saved`는 평가 그래프의 검증 통과 표시이며 실제 DB 저장 결과가 아닙니다. 모델의 근거 검수도 사람이 확정한 정답 판정과 구분합니다. 원본 로컬 자료는 `.eval`에 있고 공개본에서는 원문 자막과 로그, 가상환경을 제외했습니다.

저장된 결과는 외부 호출 없이 다시 집계할 수 있습니다.

```bash
python .eval/publish_results.py --check
python -m unittest discover -s .eval -p test_results.py
```

## main CI와 배포

[2026년 9월 4일 main CI](https://github.com/NearthYou/Studytube/actions/runs/33853188161)에서 다음 작업이 모두 성공했습니다.

| 작업 | 결과 |
| --- | --- |
| Security | Git 전체 이력과 작업 파일 secret 검사 통과 |
| Web | 313개 테스트, lint, production build 통과 |
| API | 98개 suite, 843개 테스트, lint, OpenAPI와 production build 통과 |
| AI | 184개 테스트 통과, 6개 건너뜀, 의존성 검사 통과 |
| Backend Integration | PostgreSQL, pgvector, Valkey, migration과 코스 동시 수정 검사 통과 |
| Operations | 57개 운영 계약과 실제 k6 progress-write smoke 통과 |
| Deploy | OIDC, S3와 SSM을 거쳐 EC2 배포 완료 |

Web과 API의 production dependency audit은 취약점 0건으로 끝났습니다.

## 실제 서비스 화면

같은 날 `https://studytube.page/api/health/live`가 HTTP 200을 반환했고, 실제 서비스에서 다음 화면을 열었습니다.

| 화면 | 확인 내용 | 파일 |
| --- | --- | --- |
| 학습 | YouTube 플레이어, 코스 순서, 자막 설정, 현재 문장과 학습 도구 | [studytube-learning-current.png](demo/studytube-learning-current.png) |
| 코스 만들기 | 학습 목표 입력과 추천 기준 안내 | [studytube-course-builder-current.png](demo/studytube-course-builder-current.png) |
| 코스 보관함 | 검색, 영상 개수 필터, 정렬, 영상 미리보기와 삭제 | [studytube-course-library-current.png](demo/studytube-course-library-current.png) |

## 시각 자료

| 자료 | 확인 기준 | 파일 |
| --- | --- | --- |
| 제품 방향 | 영상 시점과 공부 기록이 끊기는 문제, 이를 다시 연결하는 방식 | [studytube-product-direction.svg](diagrams/studytube-product-direction.svg) |
| 운영 아키텍처 | EC2 내부 서비스와 S3 및 Systems Manager 배포 경로 | [studytube-infrastructure-architecture.png](diagrams/studytube-infrastructure-architecture.png) |
| 데이터 모델 | 핵심 학습 엔티티와 관계 | [studytube-data-model.svg](diagrams/studytube-data-model.svg) |

운영 아키텍처 그림은 2026년 10월 15일 포트폴리오 도식으로 교체했습니다. 학습 데이터와 [퀴즈 데이터 모델](diagrams/studytube-quiz-data-model.svg)은 같은 날 저장소의 마이그레이션과 대조해 수정했습니다. 위 9월 4일 CI 결과는 이 문서 수정의 실행 결과가 아닙니다.

## 로컬 검증 명령

### Web

```powershell
npm --prefix web ci
npm --prefix web run lint
Push-Location web
node --test tests/*.test.ts
Pop-Location
npm --prefix web run build
```

### API

```powershell
npm --prefix api ci
npm --prefix api run lint
npm --prefix api test -- --runInBand
npm --prefix api run build
npm --prefix api run openapi:export
npm --prefix api run openapi:verify
```

### AI

AI의 고정 의존성과 테스트는 CI와 같은 Linux 또는 WSL 환경에서 실행합니다.

```bash
python3 -m venv ai/.venv
ai/.venv/bin/python -m pip install --require-hashes -r ai/requirements.txt
(
  cd ai
  .venv/bin/python -m unittest discover -s .
)
```

### 운영 계약

```powershell
pwsh ./operations/tests/Invoke-OperationsContractTests.ps1
```

PostgreSQL과 Valkey를 사용하는 통합 테스트는 GitHub Actions의 `Backend Integration` 작업처럼 격리된 database와 queue에서 실행합니다.

## 문서 확인

문서를 바꾼 뒤에는 다음 항목을 함께 확인합니다.

- README와 docs의 상대 링크
- README가 가리키는 이미지 파일과 해상도
- SVG 문법, 글자 잘림과 연결선
- 오래된 테스트 수치와 코드에 없는 기능 설명
- `git diff --check`
