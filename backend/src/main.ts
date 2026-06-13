import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { createRateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';
import {
  getUploadLocalRoot,
  getUploadStaticPrefix,
} from './common/upload/upload-paths';
import {
  createCorsOptions,
  loadRuntimeEnv,
  validateRuntimeConfig,
} from './config/runtime-config';

async function bootstrap() {
  loadRuntimeEnv();
  validateRuntimeConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set('trust proxy', 1);
  app.enableCors(createCorsOptions());

  app.setGlobalPrefix('api');
  app.use(createRateLimitMiddleware());
  app.useStaticAssets(getUploadLocalRoot(), {
    prefix: getUploadStaticPrefix(),
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ApiResponseInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      // DTO에 정의하지 않은 이상한 필드를 자동으로 제거
      whitelist: true,

      // 요청 body를 DTO 클래스 기준으로 변환해줍니다.
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
