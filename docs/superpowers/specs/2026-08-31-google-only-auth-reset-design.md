# StudyTube Google 전용 로그인과 전체 사용자 데이터 초기화 설계

## 배경

StudyTube는 현재 이메일 가입, 이메일 인증, 비밀번호 로그인과 비밀번호 기반 본인 확인을 사용한다. 사용자는 기존 계정을 이어 붙이지 않고 모든 사용자 데이터를 초기화한 뒤 Google 로그인만 제공하기로 결정했다.

이번 변경은 로그인 버튼 하나를 바꾸는 작업이 아니다. 기존 인증 경로 제거, Google 계정 식별, 운영 데이터 초기화, 브라우저 기록 정리, 회원 탈퇴와 복구 가능한 배포 절차를 하나의 전환으로 다룬다.

## 확정된 결정

- 기존 회원과 새 Google 계정은 연결하지 않는다.
- 기존 사용자 데이터는 모두 초기화한다.
- 초기화 전 암호화 백업을 실제 복원해 검증한다.
- 검증된 백업은 7일간 제한적으로 보관한 뒤 폐기한다.
- 이후 로그인과 가입은 Google만 사용한다.
- 회원 탈퇴는 같은 Google 계정으로 다시 확인한 뒤 즉시 영구 삭제한다.
- 이메일 로그인, 이메일 가입, 인증번호와 비밀번호 기능은 사용자 화면과 공개 API에서 제거한다.

## 목표

1. 로그인 화면에서 `Google로 계속하기` 하나만 제공한다.
2. Google의 안정적인 계정 식별자를 기준으로 신규 계정을 만든다.
3. 기존 사용자 데이터와 사용자에게서 파생된 작업 데이터를 빠짐없이 초기화한다.
4. 초기화 전에 검증된 복구 지점을 확보하고 정확히 7일 뒤 폐기한다.
5. 회원 탈퇴 시 모든 개인 학습 데이터와 세션을 즉시 제거한다.
6. 사용자에게 내부 인증 용어와 기술 오류를 노출하지 않는다.

## 비목표

- 기존 이메일 계정과 Google 계정 연결
- 다른 소셜 로그인 추가
- Google Drive, YouTube 계정 데이터 등 Google API 사용
- Google 접근 토큰 또는 갱신 토큰 저장
- 관리자 화면이나 레거시 게시판 개편
- 새 유료 인증 서비스 도입
- 이번 전환과 관계없는 학습 UI 변경

## 선택한 전환 방식

Google 인증을 먼저 배포 가능한 상태로 만들고, 점검 시간에 백업과 초기화를 수행한 뒤 Google 전용 모드로 전환한다.

한 번의 파괴적 마이그레이션에서 인증 코드, 스키마 삭제와 데이터 초기화를 모두 처리하지 않는다. 먼저 새 필드를 추가하고 Google 로그인 경로를 검증한다. 기존 비밀번호 필드와 이메일 인증 테이블은 전환이 안정된 뒤 별도 축소 마이그레이션으로 제거한다.

### 제외한 방식

#### 단일 파괴적 마이그레이션

배포 한 번으로 비밀번호 필드를 삭제하고 데이터를 초기화하는 방식이다. 빠르지만 Google 설정이나 콜백에 문제가 생겼을 때 기존 인증과 새 인증을 모두 사용할 수 없게 된다.

#### PostgreSQL과 Valkey 볼륨 재생성

서비스 저장소를 통째로 지우고 스키마를 다시 만드는 방식이다. 운영 설정, 마이그레이션 이력과 복구 증거까지 함께 잃을 수 있어 사용하지 않는다.

#### 기존 이메일 계정 자동 연결

Google이 반환한 이메일과 기존 이메일을 비교해 계정을 합치는 방식이다. 사용자가 기존 데이터 초기화를 선택했으며 잘못된 계정 연결 위험도 있어 사용하지 않는다.

## 사용자 흐름

### 로그인

1. 사용자는 로그인 화면에서 `Google로 계속하기`를 누른다.
2. Google에서 사용할 계정을 선택하고 동의한다.
3. 서버는 인증 응답을 확인한다.
4. 처음 보는 Google 계정이면 새 StudyTube 계정을 만든다.
5. 기존 Google 계정이면 해당 계정으로 로그인한다.
6. 처음 가입한 사용자는 건너뛸 수 있는 짧은 학습 설정으로 이동하고, 기존 사용자는 요청했던 화면으로 돌아간다.

로그인 화면에는 이메일 입력, 비밀번호, 회원가입 전환, 인증번호 재전송을 표시하지 않는다.

### 로그인 실패

사용자 문구는 원인과 다음 행동만 알려준다.

- 사용자가 취소한 경우: `Google 로그인을 취소했어요.`
- 세션이 만료된 경우: `로그인 시간이 지났어요. 다시 시작해 주세요.`
- 확인되지 않은 이메일인 경우: `확인된 Google 계정이 필요해요.`
- 일시적 장애인 경우: `지금은 로그인할 수 없어요. 잠시 후 다시 시도해 주세요.`

OAuth, 토큰, 공급자, state, nonce 같은 용어와 원본 오류는 노출하지 않는다.

### 회원 탈퇴

1. 사용자는 내 정보의 계정 관리에서 `회원 탈퇴`를 누른다.
2. 삭제되는 항목과 복구할 수 없다는 사실을 짧게 확인한다.
3. `Google로 본인 확인`을 누르고 현재 계정과 같은 Google 계정을 선택한다.
4. 서버는 Google 고유 식별자가 현재 회원과 같은지 확인한다.
5. 확인 완료 후 5분 안에 최종 삭제를 실행한다.
6. 서버 데이터와 모든 세션을 삭제하고 브라우저의 StudyTube 저장소를 정리한다.
7. 로그인 화면으로 이동해 `계정과 학습 기록을 삭제했어요.`를 한 번만 표시한다.

다른 Google 계정을 선택하면 삭제 권한을 만들지 않는다. 최종 삭제 버튼은 중복 요청을 막고 처리 중에는 다시 누를 수 없게 한다.

## Google 인증 설계

### 인증 방식

백엔드가 Google과 통신하는 Authorization Code 방식을 사용한다. 요청마다 다음 값을 새로 만든다.

- `state`: 로그인 요청과 콜백을 연결하고 위조 요청을 막는다.
- `nonce`: 다른 인증 응답의 재사용을 막는다.
- PKCE verifier와 challenge: 탈취된 인증 코드의 재사용을 막는다.

Google OAuth Web Client의 redirect URI는 환경별로 정확히 등록한다.

- 운영: `https://studytube.page/api/auth/google/callback`
- 로컬: 로컬 Web origin과 일치하는 별도 callback

Google Client ID와 Client Secret은 배포 비밀 설정에서만 읽으며 저장소, 브라우저 번들, 로그와 SSM 명령 본문에 넣지 않는다.

### API

```text
GET    /auth/google/start?returnTo=/requested/path
GET    /auth/google/callback
POST   /auth/logout
GET    /me

GET    /me/deletion/google/start
GET    /me/deletion/google/callback
DELETE /me
```

`returnTo`는 서비스 내부 허용 경로만 받는다. 외부 URL, protocol-relative URL과 제어 문자가 포함된 값은 거부한다.

기존 경로는 Google 전용 모드에서 404로 닫는다.

```text
POST /auth/signup
POST /auth/login
POST /auth/email-verifications/resend
POST /auth/email-verifications/consume
GET  /auth/registrations/current
POST /auth/registrations/complete
POST /me/verify
```

### 인증 시도 저장

짧은 수명의 `google_auth_attempts`를 둔다.

```ts
type GoogleAuthAttempt = {
  id: string;
  purpose: "login" | "delete_account";
  stateDigest: Buffer;
  nonceDigest: Buffer;
  encryptedCodeVerifier: Buffer;
  userId?: number;
  returnPath?: string;
  expiresAt: Date;
  consumedAt?: Date;
};
```

인증 시도는 한 번만 소비할 수 있으며 10분 뒤 만료한다. 완료, 만료와 실패한 시도는 짧은 보존 기간 뒤 제거한다. 원본 `state`, `nonce`, 인증 코드와 ID 토큰은 저장하거나 기록하지 않는다.

### Google 응답 검증

공식 `google-auth-library`를 사용해 다음 조건을 모두 확인한다.

- 서명과 키
- issuer
- audience
- 만료 시간
- nonce
- `email_verified=true`
- 인증 시도 미사용과 만료 전 상태

계정의 기준 키는 Google ID 토큰의 `sub`다. 이메일은 표시와 연락용 속성으로만 저장한다. 같은 계정의 이메일과 프로필 사진이 바뀌면 로그인 시 최신 값으로 갱신하되 계정은 바뀌지 않는다. 서비스 안에서 사용자가 정한 이름은 첫 가입 때만 Google 이름으로 채우고 이후 로그인에서는 덮어쓰지 않는다.

Google 접근 토큰과 갱신 토큰은 저장하지 않는다. StudyTube는 이 변경에서 Google API 권한을 요청하지 않으며 scope는 `openid email profile`로 제한한다.

참고 문서:

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/openid-connect/openid-connect
- https://github.com/googleapis/google-auth-library-nodejs

## 데이터 모델

### 확장 단계

`users`에 다음 필드를 추가한다.

```text
google_subject       TEXT UNIQUE
profile_image_url    TEXT
last_login_at        TIMESTAMPTZ
```

Google 전용 모드 활성화 전에는 `google_subject`를 nullable로 두고, 전체 초기화 뒤 생성되는 사용자는 반드시 값을 갖게 한다. 서비스 레벨과 데이터베이스 제약으로 Google 전용 사용자의 무결성을 보장한다.

확장 단계에서 비밀번호 관련 필드는 Google 사용자에 한해 nullable로 바꾼다. 전환 중에는 한 사용자가 Google 식별자 또는 기존 비밀번호 자격 증명 중 정확히 한 종류만 갖도록 check constraint를 둔다. Google 전용 전환이 끝나면 비밀번호 쪽 분기를 제거한다.

`email`과 `email_canonical`의 unique 제약은 제거한다. 이메일이 같다는 이유로 다른 `sub`를 기존 계정에 연결하거나 로그인을 거부하지 않는다. 로그인과 탈퇴에서 사용자 식별은 항상 `google_subject`로 처리한다.

기존 세션 테이블과 불투명 HttpOnly 세션 쿠키는 유지한다. 로그인에 성공하면 기존 세션 발급 경로를 호출하며 브라우저에 Google 토큰을 전달하지 않는다.

### 축소 단계

전환과 라이브 검증이 끝난 뒤 다음 항목을 제거한다.

- `password_hash`
- `password_algorithm`
- `password_parameters`
- `password_version`
- 비밀번호 변경과 확인 코드
- `pending_registrations`
- `verification_email_outbox`
- 이메일 인증 발송 worker와 설정

`email`, `email_canonical`과 `email_verified_at`은 Google 프로필과 확인 상태를 표현하도록 이름과 제약을 다시 검토한다. 계정 식별에는 사용하지 않는다.

## 전체 사용자 데이터 초기화

### 초기화 원칙

초기화는 운영 PostgreSQL에서 임의의 `DELETE FROM users`를 실행하는 방식으로 처리하지 않는다. 전용 명령은 계획과 실행 모드를 분리한다.

```text
npm run user-data-reset -- --plan
npm run user-data-reset -- --execute --run-id <verified-run-id>
```

계획 모드는 다음 정보를 쓰기 없이 출력한다.

- 운영 DB 식별자와 현재 마이그레이션
- 모든 public application table
- 테이블별 행 수
- 삭제 대상과 보존 대상
- 알려지지 않은 테이블
- Valkey DB와 큐 상태
- 필요한 백업 증거

실행 모드는 검증된 백업 증거, 정확한 run id, 점검 모드와 worker 중단을 모두 확인해야 시작한다. 새 테이블이 명시적 manifest에 없으면 삭제하지 않고 실패한다.

### 보존 대상

- PostgreSQL 마이그레이션 이력
- 사용자 데이터가 없는 운영 설정
- 복구와 배포를 증명하는 비식별 운영 증거

Course writer 권한과 STT 승인처럼 서비스 시작에 필요한 설정은 사용자 데이터가 없음을 검증한 뒤 별도로 내보내고 초기화 후 다시 넣는다. 그 외 public application table은 초기화한다.

### 삭제 대상

- 회원과 모든 세션
- 가입 대기, 이메일 인증과 인증 제한 기록
- 게시물, 영상 자산, 재생 목록과 코스
- 학습 항목, 진도, 메모, 저장 문장과 학습 설정
- 자막, 번역, 내용 정리와 검색 자료
- 퀴즈, 답안, 시도와 복습 상태
- 추천, Agent 실행과 제안
- 사용자 요청에서 파생된 outbox, job 결과, 실패 기록과 재실행 기록
- 공급자 사용 예약과 사용자별 비용 예약
- 사용자 콘텐츠에서 파생된 공용 캐시

초기화 트랜잭션은 외래 키 순서를 manifest로 관리하고 필요한 identity sequence를 초기값으로 되돌린다. 완료 후 모든 삭제 대상 행 수가 0인지 다시 확인한다.

### Valkey와 브라우저 저장소

운영 Valkey는 StudyTube 전용 인스턴스임을 확인한 뒤 DB를 비운다. DB 초기화가 성공했지만 Valkey 정리가 실패하면 서비스를 다시 열지 않고 정리 작업을 재시도한다.

새 Web release에는 저장소 epoch를 둔다. 최초 실행 시 다음 StudyTube 키를 모두 제거한 뒤 새 epoch만 기록한다.

- 로그인 세션
- 이어서 볼 영상과 코스 초안
- 최근 추천과 학습 기록
- 진행 중인 학습 세션
- 가져오기 초안
- 자막 표시 설정

초기화 코드는 `studytube`로 시작하는 키만 삭제하며 다른 사이트 저장소는 건드리지 않는다.

## 백업과 7일 보관

1. 점검 모드로 새 쓰기를 막고 API worker와 큐 소비를 중단한다.
2. 테이블별 행 수와 마이그레이션 상태를 기록한다.
3. PostgreSQL custom format 전체 dump를 만든다.
4. checksum을 계산하고 비공개 S3 경로에 암호화해 업로드한다.
5. 별도 임시 데이터베이스에 복원한다.
6. 모든 테이블의 행 수, 외래 키, 필수 테이블과 고아 행을 비교한다.
7. 검증된 백업 증거에 object key, checksum, 생성 시각과 폐기 예정 시각을 기록한다.
8. 초기화 완료 후 7일 동안 접근을 운영자에게만 제한한다.
9. 생성 시각 기준 7일이 되면 모든 object version과 delete marker를 제거한다.
10. 폐기 작업 뒤 object와 복제본이 실제로 없어졌는지 목록으로 확인한다.

기존 S3 bucket이 정확한 7일 폐기를 보장하지 못하면 초기화를 시작하지 않는다. 새 저장소가 필요하면 비용과 권한을 먼저 사용자에게 알리고 별도 승인을 받는다.

백업에는 사용자 데이터가 있으므로 object key와 checksum 외의 내용을 로그와 CI artifact에 남기지 않는다.

## 회원 탈퇴 삭제 계약

`DELETE /me`는 다음 조건을 모두 만족할 때만 동작한다.

- 유효한 StudyTube 세션
- 5분 안에 완료한 `delete_account` 목적의 Google 재확인
- 재확인된 `sub`와 현재 사용자의 `google_subject` 일치
- 정상 Origin과 CSRF 방어
- 동일 삭제 요청이 이미 진행 중이지 않음

삭제 서비스는 트랜잭션에서 사용자 소유 행을 제거하고 직접 외래 키가 없는 job payload와 파생 데이터도 명시적으로 정리한다. 삭제가 끝나면 모든 세션을 무효화하고 세션 쿠키를 만료한다.

여러 사용자가 함께 참조하는 영상 정보와 자막 자료는 다른 사용자의 참조가 남아 있으면 보존한다. 마지막 참조가 사라진 자료만 제거하며, 보존되는 공용 자료에 탈퇴한 사용자의 식별 정보나 입력 원문이 남지 않았는지 확인한다.

탈퇴 성공 응답에는 삭제된 내부 ID나 Google 식별자를 포함하지 않는다. 로그에는 이메일, 이름, Google 식별자와 원본 사용자 입력을 남기지 않고 비식별 성공 수치만 기록한다.

## 배포 순서

### 1단계: 확장과 비공개 검증

- Google OAuth Client 설정
- Google 인증 시도와 사용자 식별 필드 추가
- Google 로그인 서비스와 테스트 추가
- 공개 UI는 아직 기존 상태로 유지
- 운영 callback, secret과 세션 발급을 제한된 점검 경로에서 검증

### 2단계: 전환 준비 배포

- 로그인 UI를 Google 버튼 하나로 변경
- 기존 이메일 인증 API를 Google 전용 모드에서 차단
- 회원 탈퇴와 저장소 epoch 추가
- 데이터 초기화 도구를 plan mode로 실행해 live manifest와 행 수 확인

### 3단계: 점검 시간 초기화

- 점검 모드 활성화
- 쓰기와 worker 중단 확인
- 암호화 백업과 실제 복원 검증
- 사용자 데이터 초기화
- Valkey와 브라우저 storage epoch 전환
- Google 전용 모드 활성화와 서비스 재시작

### 4단계: 라이브 검증

- 새 Google 계정 생성
- 로그아웃과 재로그인
- URL 입력부터 학습, 메모, 퀴즈와 코스 저장
- 같은 Google 계정 재확인 뒤 테스트 계정 탈퇴
- 탈퇴 계정의 모든 서버 데이터, 세션과 브라우저 키 삭제 확인
- 기존 이메일 인증 경로가 닫혔는지 확인

### 5단계: 축소와 백업 폐기

- 안정화 확인 후 비밀번호와 이메일 인증 코드 제거
- 7일 뒤 백업 object와 복제본 폐기 확인
- 완료 증거에는 식별 정보 없이 count와 checksum만 기록

## 오류 처리와 복구

- Google 설정 또는 callback 검증이 실패하면 초기화를 시작하지 않는다.
- 백업 업로드, checksum 또는 복원 검증이 실패하면 초기화를 시작하지 않는다.
- 초기화 트랜잭션이 실패하면 rollback하고 점검 모드를 유지한다.
- DB 초기화 후 Valkey 정리가 실패하면 서비스 재개를 막고 재시도한다.
- Google 전용 로그인 smoke test가 실패하면 점검 모드를 유지하고 7일 백업으로 복구할 수 있다.
- 복구는 덤프 checksum 확인, 별도 복원 검증, 운영 DB 교체와 기존 release 재활성화 순서로 수행한다.

## 보안 기준

- Google Client Secret과 PKCE verifier를 평문 로그에 남기지 않는다.
- ID 토큰, authorization code, state와 nonce를 telemetry에 넣지 않는다.
- 콜백과 탈퇴 재확인은 일회성으로 처리한다.
- 세션 cookie는 production에서 `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`를 유지한다.
- 로그인 성공과 실패 응답에서 계정 존재 여부를 추측할 수 없게 한다.
- 백업 접근은 최소 권한으로 제한하고 7일 폐기를 별도로 확인한다.

## 테스트

### API

- state, nonce, PKCE, issuer, audience와 만료 검증
- 잘못된 redirect와 return path 거부
- 같은 `sub`의 중복 가입과 동시 로그인 방지
- 변경된 이메일로 로그인해도 같은 회원 유지
- 확인되지 않은 이메일 거부
- callback 재사용 거부
- 탈퇴 재확인 만료와 다른 Google 계정 거부
- 탈퇴 후 모든 세션과 사용자 데이터 삭제
- 기존 이메일 인증 경로 차단

### 초기화 도구

- plan mode 무변경 보장
- 알려지지 않은 테이블 발견 시 실행 거부
- 백업 증거가 없거나 불일치하면 실행 거부
- 트랜잭션 실패 시 원상 복구
- 전체 삭제 대상 0건과 보존 대상 유지 확인
- Valkey 정리 실패 시 서비스 재개 차단

### Web

- 로그인 화면에 Google 버튼만 표시
- 로그인 취소, 만료와 일시적 오류 문구
- 안전한 원래 화면 복귀
- 회원 탈퇴 키보드 접근과 중복 실행 방지
- 성공 후 세션과 모든 StudyTube 저장소 삭제
- 360px, 768px와 desktop에서 가로 넘침 없음

### 운영 검증

- PostgreSQL dump와 실제 restore drill
- 배포 전후 live table count 비교
- Google 신규 가입, 재로그인과 탈퇴 실제 브라우저 점검
- 이메일 로그인 경로 404 확인
- 백업의 7일 폐기 확인

## 완료 기준

- 로그인과 가입 화면에 이메일 및 비밀번호 입력이 없다.
- Google 외의 로그인 경로가 공개되지 않는다.
- Google `sub` 하나가 StudyTube 회원 하나에만 연결된다.
- 초기화 전 백업이 별도 DB에서 복원 검증된다.
- 모든 기존 사용자 및 파생 데이터가 0건이다.
- Valkey와 이전 브라우저 사용자 저장소가 정리된다.
- 새 Google 계정으로 핵심 학습 흐름을 완료할 수 있다.
- 회원 탈퇴 후 서버와 브라우저에서 관련 데이터를 찾을 수 없다.
- 백업이 7일 뒤 실제로 폐기된다.
- 사용자 화면과 로그에 인증 비밀이나 내부 기술 오류가 노출되지 않는다.
