# StudyTube 운영 검증

이 디렉터리는 운영 환경의 데이터를 노출하지 않고 복구 가능성과 핵심 API 성능을 재현하는 도구를 제공합니다. 모든 PowerShell 드릴은 먼저 계획 모드로 대상과 복구 순서를 확인할 수 있습니다. 학습 metric은 caption stage, 비용 reservation, retrieval/MCP 결과, stale quiz, Course approval conflict의 허용된 code와 count만 사용하며 자막 원문, 검색 query, 메모, URL, provider error를 기록하지 않습니다.

STT를 켠 production 배포는 `STT_COST_APPROVAL_RECORD`, 고정 model, production 환경, 최대 금액, 만료 시각과 승인 ID가 모두 있어야 합니다. 하나라도 없거나 만료되면 runtime 설치가 중단되며 기존 YouTube 자막 경로는 유지합니다.

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
  -ComposeFile ./infra/production.compose.yml `
  -ApiSocketPath /run/studytube/api.sock
```

승인된 점검 창에서 실제 실행합니다.

```powershell
pwsh ./operations/resilience/Invoke-ServiceFailureDrill.ps1 `
  -Execute `
  -AcknowledgeServiceInterruption `
  -Scenario All `
  -ComposeFile ./infra/production.compose.yml `
  -ApiSocketPath /run/studytube/api.sock `
  -AiBaseUrl http://127.0.0.1:8000
```

개별 `-Scenario` 값은 `Valkey`, `Worker`, `AI`, `Database`입니다.

운영 API readiness는 임시 TCP proxy를 만들지 않고 `-ApiSocketPath`로 지정한 Unix socket에 `curl --unix-socket`으로 직접 연결합니다. 허용되는 경로는 `/run/studytube/[A-Za-z0-9._-]+.sock`이며 기본 production systemd 경계는 `/run/studytube/api.sock`입니다. 로컬 개발처럼 API가 실제 loopback TCP listener를 사용하는 환경에서만 `-ApiSocketPath`를 생략하고 `-ApiBaseUrl`을 사용합니다.

| 시나리오 | 실패 관찰 | 자동 복구와 검증 |
| --- | --- | --- |
| Valkey | compose 서비스 중지와 실행 컨테이너 부재 | 동일 서비스 시작, PONG, AOF 활성화와 마지막 쓰기 상태 확인 |
| Worker | main PID에 SIGKILL, PID 교체 | systemd 자동 재시작, 작업 결과의 event 및 handler 중복 부재 확인 |
| AI | systemd 서비스 중지, loopback health 실패 | 동일 서비스 시작, health 성공까지 대기 |
| Database | compose 서비스 중지, API readiness 실패 | PostgreSQL 연결 수락과 API readiness 성공까지 대기 |

각 시나리오는 `finally` 복구 경로를 가집니다. 복구를 확인하지 못한 시나리오가 있으면 다음 실패 주입을 시작하지 않습니다. 스크립트는 권한 상승을 시도하지 않으므로 운영자가 필요한 systemd와 Docker 권한을 사전에 준비해야 합니다.

## k6 핵심 흐름

이 시나리오는 setup에서 안전한 live endpoint의 readiness만 확인합니다. 운영자는 secure store에서 미리 발급받은 읽기 전용 테스트 세션 하나를 `K6_SESSION_COOKIE`로 전달하거나, 서로 다른 테스트 계정의 세션을 JSON 배열인 `K6_SESSION_COOKIE_POOL`로 전달합니다. 각 VU는 번호를 기준으로 풀의 세션 하나를 선택해 모든 iteration에서 같은 명시적 Cookie header를 재사용합니다. 스크립트 자체는 로그인이나 로그아웃을 호출하지 않으므로 email/IP 로그인 rate limit을 소진하지 않으며 k6 cookie jar reset에도 의존하지 않습니다. 응답 본문, Cookie와 자격 증명은 setup return이나 증거에 저장하지 않습니다. 테스트 창이 끝나면 운영자가 사용한 모든 세션을 별도로 폐기합니다.

로컬 실행 예시는 다음과 같습니다.

```powershell
$env:K6_BASE_URL = 'http://127.0.0.1:3000'
$env:K6_READINESS_URL = 'http://127.0.0.1:3000/health/live'
$env:K6_SESSION_COOKIE = 'studytube_session=<value-from-secure-store>'
$env:K6_ACKNOWLEDGE_LOAD = 'true'
$env:K6_SEARCH_TERM = '학습'
k6 run ./operations/load/studytube-core.js
```

루프백이 아닌 주소는 정확한 대상 확인값도 필요합니다.

```powershell
$env:K6_BASE_URL = 'https://approved.example.com/api'
$env:K6_READINESS_URL = 'https://approved.example.com/api/health/live'
$env:K6_SESSION_COOKIE_POOL = (@(
  '__Host-studytube_session=<test-account-session-1>'
  '__Host-studytube_session=<test-account-session-2>'
) | ConvertTo-Json -Compress)
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
| `K6_READINESS_URL` | `${K6_BASE_URL}/health/live` | setup에서 한 번 확인하는 안전한 live endpoint. 공개 Caddy의 private readiness 경로를 사용하지 않음 |
| `K6_ACKNOWLEDGE_READINESS_TARGET` | 없음 | readiness가 비루프백의 다른 authority를 사용할 때 URL과 정확히 일치해야 하는 추가 승인값 |
| `K6_SESSION_COOKIE` | 없음 | 단일 세션 실행용 `studytube_session` 또는 `__Host-studytube_session` 이름과 값. pool과 동시에 설정할 수 없음 |
| `K6_SESSION_COOKIE_POOL` | 없음 | 서로 다른 테스트 세션의 비어 있지 않은 JSON 배열. 중복, CR/LF, 다른 cookie 이름을 거부하며 단일 cookie가 없을 때 필수 |
| `K6_SEARCH_TERM` | 학습 | 모든 실행에 사용하는 검색어 |
| `K6_EVIDENCE_PATH` | 실행 ID 기반 JSON 경로 | 결과 저장 경로 |

VU 번호가 풀 크기보다 크면 세션을 순환 배정합니다. 계정별 동시 사용을 피해야 하는 비교 실험은 세션 풀 크기를 `K6_TARGET_VUS` 이상으로 준비하고 결과 JSON의 `configuration.sessionPoolSize`를 확인합니다.

기본 임계값은 전체 오류율 1퍼센트 미만, 전체 p95 1000ms 미만, 전체 p99 2000ms 미만입니다. 게시물과 코스 목록 p95는 800ms입니다. 임계값 변경이 필요하면 코드와 실행 증거에 변경 이유를 함께 남깁니다.

## k6 진도 쓰기 계약

`studytube-progress-write.js`는 운영 데이터를 탐색하는 부하가 아니라, 격리된 계정과 Course step에서 진도 저장의 동시성과 idempotency를 확인하는 짧은 시나리오입니다. 각 VU는 한 구간을 기록한 뒤 같은 payload와 `Idempotency-Key`를 한 번 더 보내고, 마지막 조회에서 자신이 기록한 구간이 남았는지 확인합니다. setup 전 version과 teardown 후 version의 차이는 고유 요청 수와 정확히 같아야 하므로 중복 요청이 두 번째 mutation으로 반영되면 실행이 실패합니다. 기본값은 4 VU, VU당 1회이며 코드는 4 VU와 VU당 3회를 넘는 설정을 거부합니다.

비루프백 대상에서 실행하려면 다음 확인값이 모두 필요합니다.

```powershell
$env:K6_BASE_URL = 'https://approved.example.com/api'
$env:K6_READINESS_URL = 'https://approved.example.com/api/health/live'
$env:K6_SESSION_COOKIE = '__Host-studytube_session=<dedicated-test-session>'
$env:K6_COURSE_STEP_ID = '<dedicated-course-step-id>'
$env:STUDYTUBE_K6_RUN_ID = '<new-unique-run-id>'
$env:K6_ACKNOWLEDGE_WRITES = 'true'
$env:K6_ACKNOWLEDGE_TARGET = $env:K6_BASE_URL
$env:K6_ACKNOWLEDGE_DEDICATED_DATA = 'true'
$env:K6_ACKNOWLEDGE_COURSE_STEP_ID = $env:K6_COURSE_STEP_ID
k6 run ./operations/load/studytube-progress-write.js
```

실행 전에 해당 계정과 Course step이 다른 사용자 흐름과 분리되어 있는지 확인하고 매번 새 `STUDYTUBE_K6_RUN_ID`를 지정해야 합니다. 다른 쓰기가 같은 step의 version을 바꾸면 idempotency 검증이 의도적으로 실패합니다. 비루프백 대상은 HTTPS만 허용하고 인증 요청은 redirect를 따르지 않습니다. `--vus`, `--duration`, `--iterations`, `--no-setup`, `--no-teardown`, 분산 segment, HTTP debug와 TLS 검증 해제 같은 실행 override도 첫 요청 전에 거부합니다. 결과 JSON에는 대상 URL, VU 수, latency와 임계값만 남고 Cookie, Course step 원문, 응답 본문은 남지 않습니다. 필수 threshold, 흐름별 표본 수, 전체 요청 수가 모두 있어야 결과가 passed가 됩니다. 테스트가 끝나면 세션을 폐기합니다.

원본 스크립트가 Node 기반 모의 실행뿐 아니라 실제 k6 런타임에서도 동작하는지는 다음 일회성 스모크로 확인합니다.

```powershell
pwsh ./operations/tests/Invoke-K6ProgressWriteSmoke.ps1 -PlanOnly
pwsh ./operations/tests/Invoke-K6ProgressWriteSmoke.ps1 -Execute
```

스모크는 버전과 SHA-256을 고정한 k6 공식 릴리스만 내려받습니다. 임시 서버는 `127.0.0.1`의 임의 포트에만 바인딩하고 1 VU, 1 iteration으로 readiness, baseline, write, exact duplicate, readback, teardown과 summary를 확인합니다. 전용 Cookie, Course step과 응답 canary가 stdout, stderr, 결과 JSON에 남으면 실패하며, fixture 프로세스와 다운로드 파일은 종료 경로에서도 정리합니다.

## Prometheus 알람 규칙 검증

이 검증은 outbox 지연과 실패, poison event, DB pool 대기와 포화 규칙이 예상한 시점에 pending, firing, resolved 상태로 바뀌는지 `promtool`로 확인합니다. 프로덕션 EC2에 Prometheus나 Grafana daemon을 추가하지 않습니다.

계획을 확인합니다.

```powershell
pwsh ./operations/monitoring/Invoke-PrometheusRuleDrill.ps1 -PlanOnly
```

로컬 Docker에서 실제 규칙 테스트를 실행합니다.

```powershell
pwsh ./operations/monitoring/Invoke-PrometheusRuleDrill.ps1 -Execute
```

드릴은 digest로 고정한 Prometheus 이미지와 로컬 Docker context만 허용합니다. 컨테이너 네트워크와 Linux capability를 제거하고, root filesystem과 규칙 mount를 읽기 전용으로 사용합니다. `promtool` 임시 데이터만 크기가 제한된 tmpfs에 기록합니다. 이 결과는 알람 논리 검증이며 실제 scrape, Alertmanager 전달, 운영 paging이 활성화됐다는 의미는 아닙니다.

## 정적 계약 검증

다음 명령은 계획 모드가 실제 서비스에 접근하지 않는지, 임시 DB 접두사와 정리 계약이 있는지, 네 가지 실패 시나리오, 두 k6 시나리오의 안전장치와 Prometheus 드릴 경계가 유효한지 확인합니다.

```powershell
pwsh ./operations/tests/Invoke-OperationsContractTests.ps1
```

측정 JSON의 필드 정의와 실험 기록 방법은 [운영 증거 README](../docs/evidence/operations/README.md)에 있습니다.
