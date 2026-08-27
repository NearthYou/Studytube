# StudyTube 검증

README의 기능, 구조와 배포 설명은 2026년 8월 27일 main과 실제 서비스 화면을 기준으로 확인했습니다.

## main CI와 배포

[CI/CD run 33048686252](https://github.com/NearthYou/Studytube/actions/runs/33048686252)에서 다음 job이 성공했습니다.

| Job | 확인 내용 |
| --- | --- |
| Security | 전체 Git 이력과 작업 tree의 secret scan |
| Web | dependency audit, lint, test, production build |
| API | 운영 contract, OpenAPI, lint, test, production build |
| AI | dependency audit와 Python test |
| Backend Integration | PostgreSQL, pgvector, Valkey, migration, Course와 queue |
| Deploy immutable release with SSM | release 생성, AWS OIDC, S3 업로드, SSM 배포 |

같은 run에서 release 배포와 공개 진단 정보 생성까지 완료됐습니다.

## 실제 서비스 화면

Chrome의 로그인된 서비스에서 다음 화면을 확인하고 README용 캡처를 만들었습니다.

- https://studytube.page/watch?videoId=jzfoFF_bZCI
- https://studytube.page/courses

학습 화면에서는 YouTube 플레이어, Course 이동, 지금 문장, 내용 정리, 내 메모와 퀴즈 탭을 확인했습니다. Course 화면에서는 새 Course 생성과 저장한 Course 목록을 확인했습니다.

사용한 파일:

- [studytube-learning-current.png](demo/studytube-learning-current.png)
- [studytube-course-current.png](demo/studytube-course-current.png)

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

AI lockfile 설치와 test는 Linux 또는 WSL에서 실행합니다.

```bash
python3 -m venv ai/.venv
ai/.venv/bin/python -m pip install --require-hashes -r ai/requirements.txt
(
  cd ai
  .venv/bin/python -m unittest discover -s .
)
```

### 운영 contract

```powershell
pwsh ./operations/tests/Invoke-OperationsContractTests.ps1
```

PostgreSQL과 Valkey를 사용하는 통합 검사는 격리된 database와 queue에서 GitHub Actions의 Backend Integration 순서로 실행합니다.

## 문서 검증

문서 변경 뒤 다음 항목을 다시 확인합니다.

- README와 docs 문서의 상대 링크
- README가 참조하는 이미지 파일
- Mermaid block의 문법
- 금지된 과장 표현과 오래된 고정 수치
- 최신 main과 문서 diff
