# 03. NestJS HTTP 구조

목표는 NestJS에서 요청이 들어와 응답이 나가는 흐름을 이해하는 것이다.

## 핵심 구조

```txt
Module     = 기능 묶음
Controller = HTTP 입구
Service    = 실제 로직
DTO        = 요청 데이터 형태
```

현재 `api`에는 헬스체크만 있다.

```txt
GET /health
GET /health/ai
GET /health/db
```

## Controller 예시

```ts
@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHealth() {
    return this.appService.getHealth()
  }
}
```

알아야 할 문법:

- `@Controller('health')`: `/health` 주소를 담당한다.
- `@Get()`: GET 요청을 받는다.
- `constructor(...)`: Service를 주입받는다.
- `return`: JSON 응답으로 변환된다.

## Service 예시

```ts
@Injectable()
export class AppService {
  getHealth() {
    return { service: 'api', status: 'ok' }
  }
}
```

Service에는 DB 조회, 외부 API 호출, 계산 로직을 넣는다. Controller에는 복잡한 로직을 넣지 않는다.

## Module 예시

```ts
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), HttpModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

Module은 Controller와 Service를 NestJS가 알 수 있게 등록한다.

## 환경변수

NestJS에서는 `@nestjs/config`로 `.env` 값을 읽는다.

```ts
this.configService.get<string>('DATABASE_URL')
```

API key, DB 주소, JWT secret은 코드에 직접 쓰지 않는다.

## HTTP 메서드

클론 코딩에서 가장 많이 보는 메서드는 4개다.

```txt
GET    조회
POST   생성
PATCH  수정
DELETE 삭제
```

처음에는 이 4개만 익히면 된다.

## DTO와 검증

기능 개발을 시작하면 요청 body는 DTO로 받는다.

```ts
export class CreateItemDto {
  name: string
}
```

검증은 나중에 `class-validator`를 붙인다.

```ts
@IsString()
name: string
```

지금은 헬스체크만 있으므로 DTO가 필요 없다.

## 3일 제한에서 하지 않을 것

- Guard, Interceptor, Pipe 깊게 파기
- 복잡한 예외 필터
- 관리자 권한 구조
- 소셜 로그인

먼저 Controller, Service, Module 흐름을 손에 익힌다.
