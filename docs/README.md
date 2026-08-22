# StudyTube 문서 안내

## 처음 읽을 문서

| 질문 | 문서 |
| --- | --- |
| 서비스가 무엇을 해결하는가 | [README](../README.md) |
| Web, API, worker와 AI가 어떻게 연결되는가 | [architecture.md](architecture.md) |
| 팀 결과와 개인 구현 범위는 무엇인가 | [contributions.md](contributions.md) |
| 어떤 명령과 CI 결과를 확인했는가 | [verification.md](verification.md) |
| 로컬 환경은 어떻게 시작하는가 | [environment-setup.md](environment-setup.md) |
| 운영과 복구를 어떻게 검증하는가 | [operations README](../operations/README.md) |
| 배포 workflow와 실패 경계는 무엇인가 | [ci-cd.md](ci-cd.md) |
| migration과 cutover를 어떻게 다루는가 | [database-migrations.md](database-migrations.md) |

API endpoint와 Course contract는 [API README](../api/README.md), 현재 Web 화면과 상태 책임은 [Web README](../web/README.md)에 있다.

## 근거 자료

- `docs/evidence/architecture`: auth, Course, outbox와 retrieval diagram 원본
- `docs/evidence/auth`: cookie session과 verification evidence
- `docs/evidence/operations`: backup, resilience, load와 alert drill contract
- `docs/evidence/portfolio`: 만료 정책이 있는 machine-readable portfolio fact
- `docs/demo`: 실제 화면, GIF와 WebM capture

evidence는 특정 실행이나 contract를 보장하는 원자료다. 현재 제품 설명은 README와 architecture, 실행 명령과 결과는 verification이 소유한다.

## 문서 책임

완료된 계획, 발표 원고와 학습용 연재는 현재 계약이 아니다. 필요한 사실은 위 canonical 문서에 통합하고 구현 과정은 Git history에서 확인한다.
