# 운영 검증 증거

이 디렉터리는 운영 드릴의 입력 가정, 관찰값, 복구 결과를 재현 가능한 JSON으로 남깁니다. 결과 파일은 `results` 아래에 저장하며 비밀번호, 세션, Cookie, 요청 본문, 실제 행 데이터는 포함하지 않습니다.

## 공통 규칙

- 시간은 UTC ISO 8601 형식입니다.
- 시간 단위는 필드 이름에 `Seconds` 또는 `Ms`로 표시합니다.
- 모든 파일은 버전이 있는 `schemaVersion`을 가집니다.
- `status`는 `passed` 또는 `failed`입니다.
- 목표 미달과 드릴 실패는 구분합니다. 복원 무결성이 맞아도 RTO 목표를 넘으면 드릴 상태는 통과일 수 있지만 `rtoObjectiveMet`은 false입니다.
- 오류 문자열은 연결 URI의 자격 증명과 password, token, secret 계열 값을 제거한 뒤 기록합니다.
- 원본 JSON을 수정하지 않습니다. 재실행은 새 `runId`로 별도 파일을 만듭니다.

## 복원 증거 스키마

스키마 버전은 `studytube.restore-drill-evidence.v1`입니다.

| 경로 | 형식 | 설명 |
| --- | --- | --- |
| `runId` | string | UTC 시각과 무작위 접미사가 있는 실행 ID |
| `status` | string | 복원, 무결성, 정리가 모두 성공했는지 나타냄 |
| `source.rowCounts` | object | 핵심 테이블별 원본 행 수 |
| `source.rowCountFingerprintSha256` | string | 행 수 객체의 SHA-256 |
| `restore.database` | string | 허용 접두사를 가진 임시 DB 이름 |
| `restore.rowCounts` | object | 복원된 핵심 테이블별 행 수 |
| `restore.invalidForeignKeys` | integer | 검증되지 않은 외래 키 수 |
| `restore.orphanRows` | object | 핵심 관계별 고아 행 수 |
| `restore.databaseRemoved` | boolean | 임시 DB 제거 성공 여부 |
| `restore.dumpRemoved` | boolean | 컨테이너 임시 덤프 제거 성공 여부 |
| `objectives.rpoSeconds` | number | 실행 전에 선언한 RPO 목표 |
| `objectives.rtoSeconds` | number | 실행 전에 선언한 RTO 목표 |
| `measurements.observedRpoUpperBoundSeconds` | number | 덤프 시작부터 완료까지의 보수적 스냅샷 연령 상한 |
| `measurements.observedRtoSeconds` | number | 복원 시작부터 무결성 검증 완료까지의 시간 |
| `measurements.rpoObjectiveMet` | boolean | RPO 목표 충족 여부 |
| `measurements.rtoObjectiveMet` | boolean | RTO 목표 충족 여부 |
| `retention` | object | 덤프, 행 데이터, 자격 증명을 남기지 않았다는 확인 |
| `environment.composeFileSha256` | string | 실행한 compose 정의의 SHA-256 |
| `error` | string 또는 null | 정제된 주 실패 원인 |
| `cleanupErrors` | array | 정제된 정리 실패 목록 |

핵심 테이블은 `users`, `posts`, `courses`, `course_steps`, `work_outbox_events`, `work_job_results`, `retrieval_embeddings`입니다.

## 실패 복구 증거 스키마

스키마 버전은 `studytube.failure-drill-evidence.v1`입니다.

| 경로 | 형식 | 설명 |
| --- | --- | --- |
| `selectedScenario` | string | 실행한 단일 시나리오 또는 All |
| `safety.localTargetsOnly` | boolean | 루프백과 로컬 Docker 제한 적용 여부 |
| `safety.explicitInterruptionAcknowledgement` | boolean | 중단 승인 스위치 존재 여부 |
| `safety.apiTransport` | string | API readiness에 사용한 tcp 또는 unix-socket 경계 |
| `safety.apiSocketPath` | string 또는 null | Unix socket 사용 시 로컬 socket 경로 |
| `safety.apiReadinessUrl` | string | 응답 본문을 버리고 확인한 readiness URL |
| `scenarios[].hypothesis` | string | 실행 전에 선언한 복구 가설 |
| `scenarios[].baselineHealthy` | boolean | 실패 주입 전 정상 상태 여부 |
| `scenarios[].faultObserved` | boolean | 의도한 실패가 실제 관찰됐는지 여부 |
| `scenarios[].recoveryObserved` | boolean | 자동 또는 정리 경로 복구 관찰 여부 |
| `scenarios[].recoverySeconds` | number | 실패 시작부터 복구 확인까지의 시간 |
| `scenarios[].integrityCheck` | object | AOF, 작업 결과 유일성, health, DB query 확인 |
| `scenarios[].error` | string 또는 null | 정제된 시나리오 실패 원인 |
| `preflightError` | string 또는 null | 어떤 중단도 만들기 전의 안전 검사 실패 |

`faultObserved`와 `recoveryObserved`가 모두 true이고 무결성 확인이 성공해야 시나리오가 통과합니다. 복구 실패 시 다음 시나리오는 실행하지 않습니다.

## 부하 증거 스키마

스키마 버전은 `studytube.load-evidence.v1`입니다.

| 경로 | 형식 | 설명 |
| --- | --- | --- |
| `target.baseUrl` | string | 승인된 테스트 대상, 자격 증명은 없음 |
| `target.profile` | string | 현재 흐름인 authenticated-read-only |
| `configuration.readinessUrl` | string | 공개 Caddy에서도 허용되는 live endpoint |
| `configuration.authentication` | string | 현재 방식인 preprovisioned-session |
| `configuration.sessionPoolSize` | integer | Cookie 값을 노출하지 않고 기록한 서로 다른 사전 발급 세션 수 |
| `configuration` | object | VU 수, 각 구간 길이, 고정 검색어를 포함한 나머지 실행 설정 |
| `latency.overall` | object | 전체 p50, p95, p99, 평균, 최대, 표본 수 |
| `latency.publicPosts` | object | 공개 게시물 목록 지연 시간 |
| `latency.login` | object 또는 null | 스키마 호환 필드. 미리 발급한 세션 흐름에서는 null |
| `latency.posts` | object | 인증 게시물 목록 지연 시간 |
| `latency.courses` | object | 인증 코스 목록 지연 시간 |
| `latency.search` | object | 게시물 검색 지연 시간 |
| `volume.iterations` | object | 반복 수와 초당 처리량 |
| `volume.requests` | object | 요청 수와 초당 처리량 |
| `volume.flowErrors` | object | 핵심 흐름 오류율 |
| `volume.httpFailures` | object | HTTP 실패율 |
| `thresholds` | object | 각 k6 임계값의 통과 여부 |
| `retention` | object | 자격 증명, 응답 본문, Cookie 미보존 확인 |

세션 cookie는 환경에서 각 VU의 명시적 request header로만 전달되며 setup return이나 k6 cookie jar를 거치지 않습니다. VU는 번호에 따라 세션 풀을 순환 배정받고 실행 중에는 같은 세션을 재사용합니다. summary에는 readiness URL, `preprovisioned-session` 방식과 풀 크기만 기록하고 session cookie 값과 자격 증명은 기록하지 않습니다. 스크립트가 로그인이나 로그아웃을 호출하지 않으므로 `latency.login`은 null입니다.

## 진도 쓰기 증거 스키마

스키마 버전은 `studytube.progress-write-evidence.v1`입니다.

| 경로 | 형식 | 설명 |
| --- | --- | --- |
| `target.baseUrl` | string | 실행 전에 정확히 확인한 대상 URL |
| `configuration.profile` | string | `dedicated-progress-write` 고정값 |
| `configuration.dedicatedCourseStepConfigured` | boolean | 격리된 Course step 확인값을 제공했는지 여부 |
| `configuration.virtualUsers` | integer | 1에서 4 사이의 VU 수 |
| `configuration.iterationsPerVirtualUser` | integer | 1에서 3 사이의 VU별 반복 수 |
| `configuration.duplicateRequestPerIteration` | boolean | 같은 payload와 idempotency key를 다시 보냈는지 여부 |
| `completeness` | object | 필수 threshold, 흐름별 표본 수, 전체 요청 수가 모두 존재하는지 여부 |
| `latency.progressWrite` | object | 첫 진도 기록의 p50, p95, p99와 표본 수 |
| `latency.progressDuplicate` | object | 동일 요청 재전송의 p50, p95, p99와 표본 수 |
| `latency.progressReadback` | object | 저장 구간 재조회 p50, p95, p99와 표본 수 |
| `thresholds` | object | latency, check, 오류율 임계값의 통과 여부 |
| `retention` | object | 자격 증명, 응답 본문, 원문 데이터 ID 미보존 확인 |

Course step ID와 Cookie는 요청에만 사용하며 summary에는 값이나 digest를 남기지 않습니다. setup과 teardown 사이의 version 증분이 고유 요청 수와 다르거나 필수 metric이 빠지면 `status`는 failed입니다. 이 스키마의 통과는 격리된 데이터셋에서 관찰한 결과이므로 일반 사용자 데이터나 더 큰 부하의 성능으로 확대 해석하지 않습니다.

## Prometheus 규칙 증거 스키마

스키마 버전은 `studytube.prometheus-rule-drill-result.v1`입니다.

| 경로 | 형식 | 설명 |
| --- | --- | --- |
| `image` | string | digest가 고정된 Prometheus image |
| `dockerContext` | string | 허용된 로컬 Docker context |
| `results` | array | rule 문법 검사와 unit test의 상태, 종료 코드, 실행 시간 |
| `executionBoundary` | object | 로컬 Docker, 읽기 전용 mount, network 차단, 상시 서비스 미추가 확인 |
| `retention` | object | 자격 증명, metric sample, command output 미보존 확인 |

규칙 테스트는 pending, firing, resolved 전이를 검증하지만 실제 운영 지표 수집이나 알림 전달을 증명하지 않습니다. 실제 알림을 주장하려면 별도의 scrape와 전달 경로를 배포하고 live 증거를 남겨야 합니다.

## 실험 기록

각 결과 JSON과 함께 변경 설명 또는 이슈 댓글에 다음 항목을 기록합니다.

1. 가설: 어떤 실패나 부하에서 어떤 계약이 유지될 것으로 예상했는가
2. 입력: Git SHA, compose SHA-256, 테스트 계정 데이터셋 버전, 실행 시간대
3. 최초 결과: 임계값과 실패한 관찰값
4. 판단: 수정한 계약 또는 수정하지 않은 이유
5. 재실험: 새 `runId`, 같은 입력 조건, 이전 결과와의 차이
6. 수동 개입 기준: 자동 복구를 중단하고 운영자가 확인해야 하는 조건

RPO와 RTO 목표는 실행 명령에 먼저 넣고 결과를 본 뒤 바꾸지 않습니다. 부하 임계값도 동일한 VU와 검색어로 비교하며 데이터셋이 달라지면 별도 실험으로 기록합니다.
