# StudyTube 문서

| 궁금한 내용 | 문서 |
| --- | --- |
| 서비스가 해결하는 문제와 주요 기능 | [프로젝트 README](../README.md) |
| Web, API, Worker와 AI의 연결 구조 | [아키텍처](architecture.md) |
| 기능별 구현 내용과 관련 코드 | [구현 내용](implementation.md) |
| 날짜별 CI와 배포 확인 결과 | [검증 기록](verification.md) |
| 로컬에서 실행하는 방법 | [개발 환경](environment-setup.md) |
| AWS 배포와 복구 절차 | [CI/CD](ci-cd.md) |
| PostgreSQL 스키마 변경과 데이터 전환 | [DB 마이그레이션](database-migrations.md) |
| 장애, 부하와 경보 점검 | [Operations README](../operations/README.md) |

API 경로와 코스 요청 형식은 [API README](../api/README.md)에 있습니다. 화면 구성과 브라우저 상태 관리는 [Web README](../web/README.md)에 정리했습니다.

## 화면과 실행 자료

- `docs/demo`: 실제 서비스 화면과 동작 영상
- `docs/diagrams`: 학습 구성과 운영 아키텍처, 학습 및 퀴즈 데이터 모델
- `docs/evidence/architecture`: 인증, 코스, outbox와 검색 구조
- `docs/evidence/auth`: 세션과 인증 확인 자료
- `docs/evidence/operations`: 백업, 복구, 부하와 경보 실행 자료
