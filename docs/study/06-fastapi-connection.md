# 06. FastAPI 연결 구조 이해하기

이 문서는 AI 기능을 구현하기 전에 FastAPI 서버 연결 구조만 확인하는 단계다.

목표:

```txt
React -> NestJS -> FastAPI 구조 이해
```

## 1. 왜 FastAPI를 따로 두는가

NestJS는 메인 백엔드다.

```txt
인증
게시글
댓글
DB 관리
React API
```

FastAPI는 나중에 AI 기능만 맡긴다.

```txt
RAG
MCP
Agent
OpenAI API 호출
외부 API 호출
```

React가 FastAPI를 직접 호출하지 않는 이유:

```txt
인증 처리가 복잡해진다.
API 주소가 여러 개가 된다.
에러 처리 위치가 늘어난다.
```

그래서 원칙은 이렇다.

```txt
React -> NestJS -> FastAPI
```

## 2. FastAPI 실행

터미널:

```powershell
npm.cmd run dev:ai
```

확인:

```txt
http://localhost:8000/health
```

응답 예시:

```json
{
  "service": "ai",
  "status": "ok"
}
```

## 3. NestJS에서 FastAPI 확인

NestJS도 실행한다.

```powershell
npm.cmd run dev:api
```

브라우저:

```txt
http://localhost:3000/health/ai
```

의미:

```txt
브라우저 -> NestJS /health/ai
NestJS -> FastAPI /health
FastAPI -> NestJS
NestJS -> 브라우저
```

## 4. 현재 코드 흐름

파일:

```txt
api/src/app.controller.ts
```

흐름:

```ts
@Get('ai')
getAiHealth() {
  return this.appService.getAiHealth()
}
```

파일:

```txt
api/src/app.service.ts
```

흐름:

```ts
this.httpService.get(`${aiServiceUrl}/health`)
```

즉 NestJS가 FastAPI를 대신 호출한다.

## 5. FastAPI 코드

파일:

```txt
ai/main.py
```

현재 핵심 코드:

```py
@app.get("/health")
def health():
    return {
        "service": "ai",
        "status": "ok",
    }
```

FastAPI에서는 `@app.get()`으로 API를 만든다.

## 6. 나중에 AI 기능을 붙이는 방식

예를 들어 글 요약 기능을 만든다면 구조는 이렇게 된다.

```txt
React
-> POST /ai/summarize
-> NestJS
-> POST FastAPI /summarize
-> OpenAI API
-> FastAPI
-> NestJS
-> React
```

React는 여전히 NestJS만 호출한다.

## 7. 지금 하지 않을 것

```txt
OpenAI API 실제 호출
RAG 구현
MCP 구현
Agent 구현
날씨 API 호출
```

지금 목표는 연결 구조 확인뿐이다.

## 성공 기준

```txt
http://localhost:8000/health 가 응답한다.
http://localhost:3000/health/ai 가 FastAPI 상태를 보여준다.
React -> NestJS -> FastAPI 구조를 말로 설명할 수 있다.
```
