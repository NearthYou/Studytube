# StudyTube API 인증 경계

이 NestJS API는 이메일 증명부터 cookie-only 세션까지의 인증 수직 흐름을 PostgreSQL 중심으로 구현한다. 브라우저는 세션과 enrollment 원문을 HttpOnly 쿠키로만 전달하며, 서비스와 저장소에는 원문 쿠키 대신 actor 또는 SHA-256 다이제스트만 전달된다.

## 제공하는 흐름

- `POST /auth/signup`은 이메일만 받아 균일한 202 응답을 반환한다.
- 이메일 검증 소비는 enrollment 쿠키를 설정하고 응답 JSON에 자격 증명을 넣지 않는다.
- 등록 완료는 enrollment 쿠키로만 pending identity를 찾고, 사용자와 첫 digest-only 세션을 같은 트랜잭션에서 만든다.
- 로그인은 durable email/IP rate limit 이후 비밀번호를 검증한다. legacy SHA-256 성공은 Argon2id 승격과 새 세션 삽입을 같은 CAS 트랜잭션에서 수행한다.
- `GET /me`는 Session guard가 확인한 public user를 반환한다.
- logout은 활성 digest 세션을 revoke하고 쿠키를 지운다. 같은 쿠키의 재사용은 실패한다.
- explore와 기본 health 외의 보드, playlist, video asset, AI, 상세 health 경로는 기본 보호된다.

## 보안과 트랜잭션 선택

- 이메일 정규화 결과는 별도 `email_canonical` 유일 키로 유지한다.
- 비밀번호는 Node 24 Argon2id PHC로 저장하며 동시 작업과 대기열을 192MiB 메모리 예산 안에서 제한한다.
- 세션, 검증, enrollment 비밀은 영속 전에 SHA-256 다이제스트로 변환한다.
- 세션은 7일 절대 만료, 24시간 idle 만료, 15분 touch 간격을 사용한다.
- 로그인 비밀번호 검증은 사용자 잠금 밖에서 실행한다. commit은 검증한 해시와 버전을 비교하고 stale이면 한 번만 refetch와 재검증을 수행한다.
- request ID, DTO whitelist, strict CORS, Origin guard, 기본 보호 Session guard, sanitized error mapping은 `configureApplication()` 한 곳에서 설치한다.
- 등록된 컨트롤러는 Authorization 헤더를 소비하지 않는다. 보호된 board 서비스는 `{ userId }` actor만 받는다.
- production source에는 raw `sessions.token` SQL이나 인증용 메모리 fallback이 없다.

## 준비

```powershell
npm --prefix api install
Copy-Item api\.env.example api\.env
npm run db:up
npm --prefix api run db:migrate:up
```

Node.js `>=24.8.0`과 PostgreSQL 16이 필요하다. 실제 인증 검증에는 테스트 전용 데이터베이스를 사용한다.

## 검증 상태

`codex/issue-7-auth 최종 변경` 검증 시점의 결과다.

| 검증 | 결과 |
| --- | --- |
| 단위 테스트 | 22 suites, 278 tests 통과 |
| TypeScript | 통과 |
| auth boundary | production TypeScript 36개 통과 |
| Argon2 short benchmark | median 133.67ms, peak RSS 129.14MiB / 192MiB, overload rejected |
| E2E compile과 collection | 2 suites, 10 tests 완료 |
| 실제 PostgreSQL E2E | 로컬 PostgreSQL 부재로 CI pending |

```powershell
npm --prefix api test -- --runInBand
npm --prefix api run build
npm --prefix api run test:e2e -- --runInBand
npm --prefix api run db:migrate:test-adoption
```

CI는 pgvector 기반 PostgreSQL 16에서 6개 인증 시나리오와 health, board smoke를 실행할 예정이다. 현재 로컬 결과는 E2E compile과 collection만 증명하며 실제 데이터베이스 통과를 주장하지 않는다.

## 보류 항목

Resend 프로덕션 전송, React 클라이언트의 쿠키 전환, 실제 HTTPS와 reverse proxy 환경의 Secure 쿠키 브라우저 검증은 이 API 변경 이후의 작업이다. Terraform은 범위에 포함하지 않는다.

상세 근거는 [인증 근거 문서](../docs/evidence/auth/README.md)에 있다.
