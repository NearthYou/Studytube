# 05. FastAPI와 AI 서버 기초

목표는 Python 서버가 어떤 역할을 하는지 이해하고, 나중에 AI 기능을 붙일 준비를 하는 것이다.

## 현재 구현된 API

```txt
GET /health
GET /health/db
```

실행:

```powershell
npm.cmd run dev:ai
```

확인:

```txt
http://localhost:8000/health
http://localhost:8000/health/db
```

## FastAPI 기본 문법

```py
from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok"}
```

알아야 할 문법:

- `app = FastAPI()`: 서버 앱 생성
- `@app.get("/health")`: GET API 생성
- `def health()`: 요청 처리 함수
- `dict return`: JSON 응답

## Pydantic

POST 요청 body를 받을 때 사용한다.

```py
from pydantic import BaseModel

class CreateRequest(BaseModel):
    title: str
    content: str
```

지금은 헬스체크만 있으므로 아직 쓰지 않는다.

## 환경변수

FastAPI에서는 `python-dotenv`와 `os.getenv`를 쓴다.

```py
import os

database_url = os.getenv("DATABASE_URL")
```

OpenAI key, OpenWeather key는 Python 코드에 직접 쓰지 않는다.

## 외부 API 호출

나중에 날씨 API나 LLM API를 부를 때는 `httpx`를 쓴다.

```py
import httpx

response = httpx.get("https://example.com")
```

## DB 연결

현재 DB 헬스체크는 `psycopg`로 `SELECT 1`을 실행한다.

```py
with psycopg.connect(database_url) as conn:
    with conn.cursor() as cursor:
        cursor.execute("SELECT 1")
```

## AI 개념은 이 정도만

RAG:

```txt
텍스트 -> embedding -> vector 검색 -> 관련 문서 찾기
```

MCP:

```txt
LLM이 사용할 수 있는 tool 목록과 tool 실행 API를 제공한다.
```

Agent:

```txt
LLM이 상황을 보고 필요한 tool을 고른 뒤 결과를 바탕으로 다음 행동을 정한다.
```

## 지금 하지 않을 것

- OpenAI API 실제 호출
- RAG 구현
- MCP JSON-RPC 구현
- Agent loop 구현

3일 학습에서는 개념과 서버 분리 구조만 먼저 익힌다.
