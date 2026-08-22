# StudyTube 검증 범위

## GitHub Actions 기준

`c065bda9466a14bd941351e3bfc8a877e4df2422`의 run 32585076904에서 Security, Web, API, Backend Integration과 AI job은 성공했다.

Deploy immutable release with SSM job은 Configure short-lived AWS credentials 단계에서 실패했다. release artifact build까지는 성공했지만 upload와 SSM deployment는 실행되지 않았다. 이 run은 live 배포 성공 근거가 아니다.

## 로컬 명령

2026년 8월 23일 `docs/portfolio-visual-refresh-20260823`에서 확인한 결과다.

| 검사 | 결과 |
| --- | ---: |
| Web Node test | 216 passed |
| Web lint와 production build | exit 0 |
| API Jest | 720 passed, 1 skipped |
| API lint와 production build | exit 0 |
| AI unittest | 126 passed, 6 skipped |
| Operations contract | 57 assertions passed |
| Web production dependency audit | 0 vulnerabilities |
| API production dependency audit | 0 vulnerabilities |
| portfolio fact contract | exit 1, expired fact 10개 |

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
```

### AI

```powershell
python -m venv ai/.venv
ai/.venv/Scripts/python.exe -m pip install --require-hashes -r ai/requirements.txt
Push-Location ai
.venv/Scripts/python.exe -m unittest discover -s .
Pop-Location
```

Linux CI는 hash-locked `requirements.txt` 설치를 통과했다. Windows local install은 `uvloop==0.22.1`이 Windows를 지원하지 않아 같은 command로 완료되지 않았다. repository 파일은 바꾸지 않고 `requirements.in`의 direct dependency로 Windows venv를 만든 뒤 test를 실행했다.

### PostgreSQL과 Valkey integration

integration suite는 migration, fixture와 queue를 변경한다. 공유 database가 아니라 격리된 PostgreSQL과 Valkey에서 CI의 `Backend Integration` 순서를 따라야 한다.

## 문서 작업에서 확인한 화면

현재 main의 Web을 `127.0.0.1`에서 실행해 `/login`과 `/signup`을 새로 캡처했다. 입력과 form submit은 수행하지 않았다.

인증 이후 learning workspace는 API, PostgreSQL과 test account가 필요하다. 이번 문서 작업에서는 이전 demo를 current main E2E처럼 재사용하지 않는다.

## evidence contract의 한계

`docs/evidence/portfolio/facts.json`의 10개 fact는 2026-08-06에 만료됐고 status가 pending이다. 따라서 `npm run portfolio:verify`는 현재 exit 1이다. 이 파일을 2026-08-17 또는 현재 배포 근거로 사용하지 않는다.

## 결과 기록 규칙

실행한 command의 exit code와 실제 count만 기록한다. environment가 없어 실행하지 못한 integration, 배포와 browser E2E는 통과로 표시하지 않는다.
