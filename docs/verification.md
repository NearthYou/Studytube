# StudyTube 검증 기록

기준일은 2026년 9월 4일입니다. 수치와 화면은 같은 날의 `main` CI와 배포 서비스에서 가져왔습니다.

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
| 시스템 아키텍처 | 공개 진입점, 내부 서비스, 데이터 저장소와 배포 경로 | [studytube-system-architecture.svg](diagrams/studytube-system-architecture.svg) |
| 데이터 모델 | 핵심 학습 엔티티와 관계 | [studytube-data-model.svg](diagrams/studytube-data-model.svg) |

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
