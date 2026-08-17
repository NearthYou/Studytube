# StudyTube 저비용 EC2 재배포 설계

## 상태

- 승인일: 2026-08-17
- 선택 방식: 기존 단일 EC2, GitHub OIDC, S3 release, SSM 배포 복구
- 목표 월 비용: 약 $16.42~$16.46
- 배포 대상: 현재 수정 사항을 검증하고 `main`에 반영한 단일 release
- 제외 경로: `docs/presentation`

## 목표

StudyTube를 포트폴리오 방문자가 언제든 접속할 수 있는 HTTPS 서비스로 다시 배포한다. 기존에 검증한 immutable release와 SSM 배포 흐름을 재사용하고, 관리형 데이터베이스나 로드밸런서를 추가하지 않아 월 비용을 약 $16대로 제한한다.

성공 기준은 다음과 같다.

- `studytube.page`가 유효한 TLS 인증서로 응답한다.
- Web, API, AI, worker, PostgreSQL, Valkey가 단일 호스트에서 재부팅 후 자동 복구된다.
- 회원가입, 로그인, 프로필 저장, 영상이 없는 watch 화면이 브라우저에서 정상 동작한다.
- `main` 배포가 GitHub OIDC와 SSM을 사용하며 SSH 인바운드 포트를 요구하지 않는다.
- AWS 비용 자원은 이 문서에 명시한 StudyTube 증분 자원으로 제한된다.

## 선택한 접근

서울 리전의 `t3.micro` 한 대에 애플리케이션과 데이터 계층을 함께 운영한다. PostgreSQL과 Valkey는 Docker Compose volume에 데이터를 보존하고, API, AI, worker는 systemd 서비스로 실행한다. Caddy는 정적 Web 파일과 HTTPS 진입점을 담당한다.

기존 배포 경계를 그대로 복구한다.

1. GitHub Actions가 검증된 `main` commit으로 deterministic release를 만든다.
2. GitHub OIDC로 단기 AWS 권한을 얻어 commit SHA 기반 S3 key에 release를 업로드한다.
3. SSM Run Command가 지정된 EC2 managed node에 release SHA와 digest를 전달한다.
4. 서버가 release를 검증하고 별도 디렉터리에 준비한 뒤 migration과 health check를 통과한 경우에만 `current` 링크를 전환한다.
5. 활성화가 실패하면 기존 release로 rollback하고 공개 Caddy를 안전한 상태로 복구한다.

이 방식은 Lightsail보다 월 비용이 약 $4 높지만, 현재 저장소의 OIDC, SSM, release 검증, 중단 복구 계약을 그대로 사용할 수 있다. 배포 체계를 새로 만드는 비용과 포트폴리오 장애 위험을 줄이는 것이 작은 월 비용 차이보다 중요하다.

## 검토한 대안

### Lightsail 2GB

공개 IPv4와 60GB SSD를 포함해 월 $12로 더 저렴하고 메모리도 넉넉하다. 그러나 Lightsail에는 현재 EC2 IAM instance profile과 동일한 SSM 배포 경계가 없으므로 pull 배포나 별도 자격 증명 설계가 필요하다. 이번 재배포에서는 제외한다.

### Lightsail 1GB

월 $7로 가장 저렴하지만 PostgreSQL, Valkey, Node.js API, Python AI service를 함께 운영할 때 메모리 여유가 부족하다. swap에 의존하면 배포와 AI 처리 지연이 커지고 OOM 장애를 설명하기 어려워 제외한다.

### 시간제 EC2

하루 8시간만 실행하면 월 약 $7.6까지 줄일 수 있다. 대신 포트폴리오 방문 시간에 서비스가 꺼질 수 있고 자동 할당 IP를 쓰면 DNS 갱신도 필요하다. 이번 목표인 상시 공개 서비스와 맞지 않아 제외한다.

## AWS 자원 경계

재생성하는 유료 또는 사용량 기반 자원은 다음으로 제한한다.

| 자원 | 구성 | 역할 |
| --- | --- | --- |
| EC2 | `t3.micro`, Linux, CPU credit standard | 전체 애플리케이션 runtime |
| EBS | encrypted gp3 30GiB, 기본 IOPS와 throughput | OS, release, PostgreSQL, Valkey 데이터 |
| Public IPv4 | 인스턴스에 연결한 Elastic IP 1개 | 고정 HTTPS 진입점 |
| Route 53 | `studytube.page` public hosted zone 1개 | apex DNS |
| S3 | private release bucket 1개 | SHA 기반 immutable release 보관 |
| CloudWatch | 배포 진단 log group 1개, 30일 보존 | SSM 배포 로그 |
| SES | 기존 검증 identity와 configuration set 재사용 | 가입 인증 메일 |

StudyTube를 위해 RDS, ElastiCache, ECS, NAT Gateway, Application Load Balancer, CloudFront, OpenSearch를 만들지 않는다. 같은 계정의 SketchCatch 자원과 Amazon Q 자원은 배포 대상과 IAM 권한 범위에서 제외한다.

## 애플리케이션 구성과 데이터 흐름

Caddy는 80과 443만 공개한다. Web 정적 파일은 `/var/www/studytube/current`에서 제공하고 `/api/*` 요청은 Unix socket으로 API에 전달한다. API는 loopback PostgreSQL과 Valkey에 연결하고 AI service는 loopback HTTP로 호출한다. worker는 durable work record를 claim한 뒤 동일한 PostgreSQL과 Valkey를 사용한다.

PostgreSQL과 Valkey는 외부 포트를 공개하지 않는다. systemd가 API, AI, worker, Caddy를 재시작하고 Docker가 PostgreSQL과 Valkey를 `unless-stopped` 정책으로 복구한다. 애플리케이션 secret은 repository, release artifact, S3 object, 로그에 포함하지 않고 호스트의 제한된 production environment 파일에만 둔다.

## 배포와 rollback

배포 대상은 현재 수정 branch의 검증된 commit이다. 먼저 branch를 PR로 `main`에 반영하고 모든 필수 CI가 통과한 같은 commit을 배포한다. AWS resource를 생성한 뒤 최초 runtime 설치와 production environment 구성을 수행하고, 이후 배포는 기존 `ci-cd.yml`의 OIDC와 SSM 경로를 사용한다.

Release는 commit SHA와 SHA-256 digest로 식별한다. 준비 단계에서 build, dependency install, migration, service health가 실패하면 현재 release를 바꾸지 않는다. Cutover 뒤 문제가 발생하면 schema compatibility barrier와 Course activation 상태를 확인해 안전한 경우 이전 release로 rollback하고, 이미 durable boundary를 넘은 경우 동일 release roll-forward만 허용한다.

## 비용 통제

기존 검증 예산을 기준으로 24시간 월 예상액은 약 $16.42~$16.46이다.

- EC2 `t3.micro`: 약 $9.49
- gp3 30GB: 약 $2.74
- Public IPv4: 약 $3.65
- Route 53 hosted zone: $0.50
- S3, DNS query, SES: 소량 사용 기준 약 $0.04~$0.08

CPU credit은 `standard`로 고정해 unlimited surplus charge를 막는다. S3 key는 commit SHA로 한 번만 쓰고 lifecycle로 오래된 release와 noncurrent version을 정리한다. CloudWatch log retention은 30일로 제한한다. AWS resource 생성 후 실제 Billing과 Cost Explorer에서 StudyTube 증분 비용을 다시 확인한다.

## 보안과 운영 경계

- Security Group 인바운드는 80과 443만 허용한다.
- SSH 22번 포트와 공개 PostgreSQL, Valkey, API, AI 포트는 열지 않는다.
- GitHub Actions는 long-lived AWS key 대신 OIDC role을 사용한다.
- EC2 role은 SSM managed node, 지정 release bucket read, 필요한 log write 범위만 가진다.
- Deploy role은 지정 repository의 `main` ref만 신뢰하고 지정 bucket key와 대상 instance command로 제한한다.
- Production 환경 파일과 secret은 브라우저, CLI 출력, CI artifact, 공개 증거에 복사하지 않는다.

## 검증 계획

배포 전에는 현재 branch에서 Web, API, AI, backend integration, operations contract, immutable deployment contract, production build를 실행한다. PR CI가 모두 통과한 commit만 `main`에 반영한다.

배포 후에는 다음을 확인한다.

1. DNS apex가 새 Elastic IP를 가리킨다.
2. TLS hostname과 인증서 chain이 유효하다.
3. HTTP가 HTTPS로 전환되고 공개하지 않은 health 및 internal route는 404를 반환한다.
4. 회원가입 인증 요청과 로그인, session cookie가 production proxy 뒤에서 동작한다.
5. 프로필 저장이 `PUT /api/me` 경로로 성공하고 한국어 오류 문구를 사용한다.
6. 등록 영상이 없을 때 watch 페이지가 빈 화면 대신 안내 상태를 보여 준다.
7. PostgreSQL, Valkey, API, AI, worker, Caddy가 실행 중이며 재부팅 뒤 자동 복구된다.
8. GitHub deploy job이 OIDC credential과 SSM command를 거쳐 같은 commit을 배포한다.
9. Cost Explorer에서 예상하지 않은 StudyTube 유료 서비스가 생기지 않았다.

Live 검증은 작은 읽기와 1회성 기능 확인으로 제한하고 별도 부하 테스트나 장애 주입은 이번 재배포의 완료 조건에 포함하지 않는다.

## 제외 범위

- 관리형 고가용성 데이터베이스와 cache 도입
- multi-AZ, autoscaling, load balancer 구성
- Amazon Q 또는 SketchCatch 인프라 변경
- SES sandbox 해제 보장
- 외부 Notion, 블로그, 이력서 동기화
- `docs/presentation` 수정

## 승인 기준

- 사용자가 기존 단일 EC2 방식과 월 약 $16.4 예산을 승인했다.
- 현재 branch 변경이 CI를 통과해 `main`에 병합된다.
- 지정한 StudyTube AWS 자원만 생성된다.
- 동일 commit의 production 배포와 핵심 브라우저 흐름이 성공한다.
- 비용 검증 결과가 예산 범위와 일치하거나 차이를 설명할 수 있다.
