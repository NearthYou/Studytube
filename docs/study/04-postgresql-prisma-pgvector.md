# 04. PostgreSQL + Prisma + pgvector

목표는 DB를 왜 쓰고, Prisma와 pgvector가 각각 무슨 역할인지 이해하는 것이다.

## 알아야 할 개념

- `PostgreSQL`: 데이터를 저장하는 관계형 DB다.
- `Table`: 데이터를 담는 표다.
- `Row`: 실제 데이터 한 줄이다.
- `Primary Key`: row를 구분하는 고유 ID다.
- `Foreign Key`: 다른 테이블과 연결하는 ID다.
- `Migration`: DB 구조 변경 기록이다.
- `Prisma`: TypeScript에서 DB를 다루기 쉽게 해주는 ORM이다.
- `pgvector`: PostgreSQL에 벡터 검색 기능을 추가한다.

## 현재 DB 실행

```powershell
npm.cmd run db:up
```

연결 주소:

```txt
postgresql://app:app@localhost:5432/app_dev
```

## Prisma의 역할

Prisma는 DB 테이블 구조를 `schema.prisma`에 적고, TypeScript 코드에서 안전하게 DB를 쓰게 해준다.

현재는 학습용 최소 파일만 있다.

```txt
api/prisma/schema.prisma
```

나중에 서비스가 정해지면 여기에 모델을 추가한다.

```prisma
model Item {
  id        Int      @id @default(autoincrement())
  name      String
  createdAt DateTime @default(now())
}
```

모델을 추가한 뒤 실행:

```powershell
npm.cmd --prefix api run prisma:generate
npm.cmd --prefix api run prisma:migrate -- --name init
```

## 관계를 읽는 법

서비스가 정해진 뒤 관계를 잡는다. 지금은 아래 개념만 이해한다.

```txt
1:N = 한 명의 사용자가 여러 글을 쓴다.
N:M = 하나의 글에 여러 태그, 하나의 태그가 여러 글에 붙는다.
1:1 = 하나의 글에 하나의 embedding이 붙는다.
```

## pgvector의 역할

AI 검색을 하려면 문장을 숫자 배열로 바꾼다. 이 숫자 배열을 embedding이라고 부른다.

```txt
문장 -> embedding vector -> DB 저장 -> 가까운 vector 검색
```

OpenAI `text-embedding-3-small`은 기본 벡터 길이가 1536이다. 그래서 나중에 AI 검색을 구현하면 보통 이런 컬럼을 쓴다.

```sql
embedding vector(1536)
```

현재는 pgvector extension만 준비했다.

```txt
api/prisma/sql/pgvector-setup.sql
```

## 지금 하지 않을 것

- 실제 테이블 설계 확정
- 게시판 모델 작성
- RAG 검색 구현
- 복잡한 인덱스 튜닝

서비스 주제가 정해지기 전에는 DB 모델을 만들지 않는다.
