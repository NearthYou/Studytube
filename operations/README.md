# StudyTube 운영 검증

이 디렉터리는 운영 환경의 데이터를 노출하지 않고 복구 가능성과 핵심 API 성능을 재현하는 도구를 제공합니다. 모든 PowerShell 드릴은 먼저 계획 모드로 대상과 복구 순서를 확인할 수 있습니다.

## 사전 조건

- PowerShell 7 이상
- 로컬 Docker 엔진과 Docker Compose
- 복구 드릴을 실행할 호스트의 systemd
- 부하 테스트용 k6
- 테스트 전용 로그인 계정

PowerShell 스크립트는 원격 Docker 컨텍스트를 거부합니다. 허용 컨텍스트는 `default`와 `desktop-linux`이며 `DOCKER_HOST`가 TCP 주소를 가리키면 중단합니다. 실패 주입 스크립트는 API와 AI URL이 `127.0.0.1`, `localhost`, IPv6 loopback 중 하나인지도 확인합니다.

## PostgreSQL 백업 및 복원

계획만 확인합니다.

```powershell
pwsh ./operations/backup/Invoke-PostgresRestoreDrill.ps1 `
  -PlanOnly `
  -ComposeFile ./infra/production.compose.yml `
  -DatabaseName app_dev `
  -DatabaseUser app
```

실제 검증을 실행합니다.

```powershell
pwsh ./operations/backup/Invoke-PostgresRestoreDrill.ps1 `
  -Execute `
  -ComposeFile ./infra/production.compose.yml `
  -DatabaseName app_dev `
  -DatabaseUser app `
  -RpoObjectiveSeconds 300 `
  -RtoObjectiveSeconds 900
```

실행 순서는 다음과 같습니다.

1. 요청한 compose 파일이 실제 PostgreSQL 컨테이너를 만든 파일인지 확인합니다.
2. 필수 테이블, 행 수, 외래 키 상태, 고아 행 수를 읽습니다.
3. 컨테이너 내부 임시 경로에 custom format `pg_dump`를 만듭니다.
4. `studytube_restore_verify_` 접두사가 붙은 무작위 임시 데이터베이스를 생성합니다.
5. `pg_restore --exit-on-error`로 복원합니다.
6. 원본과 복원본의 핵심 행 수를 비교하고 외래 키와 고아 행을 검사합니다.
7. 성공 여부와 관계없이 임시 데이터베이스와 덤프를 제거합니다.
8. 행 데이터와 자격 증명이 없는 JSON 증거를 기록합니다.

원본 데이터에 쓰기가 계속되는 동안에는 덤프 스냅샷과 사전 행 수 사이에 차이가 날 수 있습니다. 정확한 행 수 비교가 필요한 실행은 쓰기가 없는 검증 창에서 수행합니다. 이 드릴은 시점 복구를 제공하지 않으며 `observedRpoUpperBoundSeconds`는 덤프가 완료될 때 스냅샷이 가질 수 있는 보수적인 최대 연령으로 기록합니다. `observedRtoSeconds`는 임시 복원 시작부터 무결성 검증 완료까지입니다.

덤프 파일은 호스트로 복사하지 않고 컨테이너의 임시 경로에서 제거합니다. JSON만 `docs/evidence/operations/results`에 남습니다.

## 서비스 실패 및 복구

계획만 확인합니다.

```powershell
pwsh ./operations/resilience/Invoke-ServiceFailureDrill.ps1 `
  -PlanOnly `
  -Scenario All `
  -ComposeFile ./infra/production.compose.yml
```

승인된 점검 창에서 실제 실행합니다.

```powershell
pwsh ./operations/resilience/Invoke-ServiceFailureDrill.ps1 `
  -Execute `
  -AcknowledgeServiceInterruption `
  -Scenario All `
  -ComposeFile ./infra/production.compose.yml `
  -ApiBaseUrl http://127.0.0.1:3000 `
  -AiBaseUrl http://127.0.0.1:8000
```

개별 `-Scenario` 값은 `Valkey`, `Worker`, `AI`, `Database`입니다.

| 시나리오 | 실패 관찰 | 자동 복구와 검증 |
| --- | --- | --- |
| Valkey | compose 서비스 중지와 실행 컨테이너 부재 | 동일 서비스 시작, PONG, AOF 활성화와 마지막 쓰기 상태 확인 |
| Worker | main PID에 SIGKILL, PID 교체 | systemd 자동 재시작, 작업 결과의 event 및 handler 중복 부재 확인 |
| AI | systemd 서비스 중지, loopback health 실패 | 동일 서비스 시작, health 성공까지 대기 |
| Database | compose 서비스 중지, API readiness 실패 | PostgreSQL 연결 수락과 API readiness 성공까지 대기 |

각 시나리오는 `finally` 복구 경로를 가집니다. 복구를 확인하지 못한 시나리오가 있으면 다음 실패 주입을 시작하지 않습니다. 스크립트는 권한 상승을 시도하지 않으므로 운영자가 필요한 systemd와 Docker 권한을 사전에 준비해야 합니다.

## k6 핵심 흐름

이 시나리오는 공개 게시물 목록, 공개 코스 목록, 로그인, 인증 게시물 목록, 인증 코스 목록, 게시물 검색, 로그아웃을 같은 반복에서 실행합니다. 운영 데이터를 늘리지 않도록 읽기 중심으로 구성했으며 응답 본문, Cookie, 이메일, 비밀번호를 증거에 저장하지 않습니다.

로컬 실행 예시는 다음과 같습니다.

```powershell
$env:K6_BASE_URL = 'http://127.0.0.1:3000'
$env:K6_LOGIN_EMAIL = 'load-test@example.com'
$env:K6_LOGIN_PASSWORD = '<secret-from-secure-store>'
$env:K6_ACKNOWLEDGE_LOAD = 'true'
$env:K6_SEARCH_TERM = '학습'
k6 run ./operations/load/studytube-core.js
```

루프백이 아닌 주소는 정확한 대상 확인값도 필요합니다.

```powershell
$env:K6_BASE_URL = 'https://approved.example.com/api'
$env:K6_ACKNOWLEDGE_LOAD = 'true'
$env:K6_ACKNOWLEDGE_TARGET = $env:K6_BASE_URL
k6 run ./operations/load/studytube-core.js
```

기본 부하는 2 VU에서 10 VU로 30초 동안 증가하고 2분 유지한 뒤 30초 동안 감소합니다. 다음 환경 변수로 고정 데이터셋과 부하를 조정할 수 있습니다.

| 변수 | 기본값 | 의미 |
| --- | --- | --- |
| `K6_START_VUS` | 2 | 시작 VU 수 |
| `K6_TARGET_VUS` | 10 | 유지 구간 VU 수 |
| `K6_RAMP_DURATION` | 30s | 증가 구간 |
| `K6_STEADY_DURATION` | 2m | 유지 구간 |
| `K6_COOL_DOWN_DURATION` | 30s | 감소 구간 |
| `K6_SEARCH_TERM` | 학습 | 모든 실행에 사용하는 검색어 |
| `K6_EVIDENCE_PATH` | 실행 ID 기반 JSON 경로 | 결과 저장 경로 |

기본 임계값은 전체 오류율 1퍼센트 미만, 전체 p95 1000ms 미만, 전체 p99 2000ms 미만입니다. 로그인 p95는 1500ms, p99는 2500ms이며 게시물과 코스 목록 p95는 800ms입니다. 임계값 변경이 필요하면 코드와 실행 증거에 변경 이유를 함께 남깁니다.

## 정적 계약 검증

다음 명령은 계획 모드가 실제 서비스에 접근하지 않는지, 임시 DB 접두사와 정리 계약이 있는지, 네 가지 실패 시나리오와 k6 문법이 유효한지 확인합니다.

```powershell
pwsh ./operations/tests/Invoke-OperationsContractTests.ps1
```

측정 JSON의 필드 정의와 실험 기록 방법은 [운영 증거 README](../docs/evidence/operations/README.md)에 있습니다.
