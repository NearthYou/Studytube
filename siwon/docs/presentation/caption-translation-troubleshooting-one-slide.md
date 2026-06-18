# PPT 1장 요약본: AI 번역 자막 트러블슈팅 최신 버전

## 제목

긴 영상 AI 번역 자막: 전체 번역에서 prepared asset + playback window 구조로

## 문제

- YouTube 원문 자막은 있지만 한국어 AI 자막이 늦게 표시됨
- 긴 영상 전체 transcript를 한 번에 번역하려 하면 첫 자막까지 지연됨
- 영어 source caption을 그대로 보여주는 것은 요구사항을 만족하지 못함
- YouTube caption fetch는 rate limit, 쿠키, po token 같은 외부 조건에도 영향받음

## 해결

- 저장된 `prepared-video-asset`이 있으면 즉시 자막으로 사용
- 부족한 구간은 현재 재생 시간 기준 60초 playback window로 번역
- 주변 window prefetch로 다음 구간을 미리 준비
- `openai-caption-translation`과 `prepared-video-asset`만 표시용으로 merge
- `YOUTUBE_COOKIES_FILE`을 HTTP 요청 cookies에 반영해 원문 자막 수급 안정성 개선

## 요약 전사문 개선

- 모든 segment에 timestamp를 찍지 않음
- 60초 interval로 전사문을 묶어 복습용 타임라인으로 압축
- 앞부분만 몰리지 않고 영상 전체 흐름을 다시 찾기 쉽게 구성

## 검증

- window 계산 / prefetch / request key 테스트
- prepared asset coverage와 fallback window merge 테스트
- source caption이 번역 자막에 섞이지 않는지 테스트
- YouTube cookie file 주입 테스트
- 요약 전사문 60초 interval 출력 테스트

## 발표 한 문장

문제는 AI 번역 자체보다 작업 단위와 데이터 흐름이었다. prepared asset을 우선 사용하고, 부족한 부분은 playback window 단위로 번역하며, source caption 수급과 merge 규칙까지 분리해 긴 영상에서도 빠르고 안정적인 한국어 AI 자막 경험을 만들었다.
