# StudyTube 인증 백엔드 사례

StudyTube는 YouTube 학습 자료를 코스와 보드로 관리하는 서비스다. 이 포트폴리오 변경은 기존 Bearer 토큰과 SHA-256 기반 가입 경로를 이메일 증명, Argon2id, PostgreSQL 트랜잭션, HttpOnly 쿠키를 사용하는 인증 경계로 교체한다.

## 해결한 문제

기존 방식에서는 이메일 소유를 확인하기 전에 계정을 만들 수 있어 선점 가입 위험이 있었다. 원문 세션 토큰을 데이터베이스와 클라이언트 저장소에서 다루는 구조도 유출 범위를 넓혔다.

현재 가입과 인증 흐름은 다음과 같다.

1. 가입 요청은 이메일만 받고 검증 비밀의 다이제스트와 outbox 메타데이터를 저장한다.
2. 이메일 검증이 성공하면 짧게 사는 enrollment 다이제스트를 발급한다.
3. 유효한 enrollment가 확인된 뒤에만 이름과 비밀번호를 받아 Argon2id 해시, 사용자, 첫 세션 다이제스트를 한 트랜잭션에서 만든다.
4. 로그인은 사용자 잠금 밖에서 비밀번호를 검증하고, 해시와 버전의 compare-and-set이 이긴 트랜잭션만 새 세션을 만든다.
5. 브라우저는 세션과 enrollment 원문을 HttpOnly 쿠키로만 전달한다. 등록된 HTTP 컨트롤러에는 Authorization 또는 Bearer 소비자가 없다.

## 구현된 경계

- `AuthService`가 이메일 정규화, 균일한 가입 수락, 검증 소비, 등록 완료, 로그인 재검증, 세션 조회, logout을 담당한다.
- `DatabaseService`가 durable rate limit, pending registration, 검증, 등록 완료, 로그인 CAS, digest-only 세션 조회와 revoke를 PostgreSQL에 구현한다. 인증 실패 시 메모리 저장소로 전환하지 않는다.
- 비밀번호는 Node 24의 Argon2id PHC로 저장한다. 기존 `legacy_sha256` 자격 증명은 성공한 로그인 트랜잭션에서만 Argon2id로 승격된다.
- 세션은 7일 절대 만료와 24시간 idle 만료를 사용한다. 활성 조회는 PostgreSQL 시간을 사용하고, 15분 간격으로만 touch하며 절대 만료를 넘지 않는다.
- Nest HTTP 경계는 request ID, 엄격한 DTO 검증, CORS, Origin guard, 기본 보호 Session guard, 안정된 오류 응답을 한 bootstrap 경로로 구성한다.
- 보호된 보드와 비디오 서비스에는 쿠키나 토큰 대신 동결된 `{ userId }` actor만 전달한다.
- 정적 경계 검사에서 production TypeScript 36개를 확인했으며 Bearer 소비자와 `sessions.token` SQL은 제거된 상태다.

## 검증 결과

`codex/issue-7-auth 최종 변경` 검증 시점의 결과다.

| 검증 | 결과 |
| --- | --- |
| API 단위 테스트 | 22 suites, 278 tests 통과 |
| TypeScript | 통과 |
| 인증 경계 정적 검사 | production TypeScript 36개 통과 |
| 짧은 Argon2 benchmark | median 133.67ms, peak RSS 129.14MiB / 192MiB, overload rejected |
| E2E compile과 collection | 2 suites, 10 tests 완료 |
| 로컬 PostgreSQL E2E 실행 | PostgreSQL 부재로 CI pending |

E2E는 컴파일과 테스트 수집까지 확인했다. 실제 데이터베이스 실행은 CI의 pgvector 기반 PostgreSQL 16에서 진행하며, 6개 인증 시나리오와 health, board smoke를 검증할 예정이다. 로컬 PostgreSQL이 없었던 환경에서는 실행 완료로 표기하지 않는다.

## 재실행

```powershell
npm --prefix api test -- --runInBand
npm --prefix api run build
npm --prefix api run test:e2e -- --runInBand
```

PostgreSQL을 사용하는 E2E와 migration adoption 검증에는 별도의 테스트 데이터베이스와 `DATABASE_URL`이 필요하다.

## 보류 항목

이 변경은 인증 API와 서버 경계를 완성하는 범위다. Resend 프로덕션 전송, React의 쿠키 기반 전환, 실제 HTTPS와 reverse proxy에서의 Secure 쿠키 브라우저 검증은 후속 작업으로 남긴다. Terraform은 사용하거나 추가하지 않는다.

상세 주장과 근거, 아키텍처와 경쟁 다이어그램은 [인증 근거 문서](docs/evidence/auth/README.md)에 정리했다.
